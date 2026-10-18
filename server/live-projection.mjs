import fs from 'node:fs';
import path from 'node:path';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {assertPrivate,ensurePrivateDirectory,writePrivateExclusive} from '../platform/private-files.mjs';

const states=new Set(['observed','working','approval','waiting-input','turn-ended','between-tools','tool-failed','unknown']);
const kinds=new Set(['sessionStart','sessionEnd','toolStart','toolEnd','permissionRequest','turnEnd','subagentStart','subagentEnd','subagentTurnEnd']);
const tools=new Set(['Read','Grep','Glob','Edit','Write','Bash','WebFetch','WebSearch','Agent','Task','AskUserQuestion','Other']);
const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const only=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const safeError=()=>Error('Private live state unavailable; no recovery by discarding state.');

// A bounded durable projection, not a claim of a producer event ledger. Native
// IDs are keyed by a private HMAC and never persisted or exposed to the browser.
export function openLiveProjection({directory,source='live',environment='local',maxSessions=100,maxRecords=1000,deltaLimit=128,now=()=>new Date().toISOString()}){
 if(!['live','fixture'].includes(source))throw safeError();
 ensurePrivateDirectory(directory);
 const file=path.join(directory,`claude-${source}.json`),epoch=randomUUID();
 let state={version:2,installationInstanceId:randomUUID(),salt:randomBytes(32).toString('hex'),revision:0,nextRenderId:1,lastEventAt:null,records:[],timeline:[]};
 const validate=value=>{
  if(!only(value,['version','installationInstanceId','salt','revision','nextRenderId','lastEventAt','records','timeline'])||![1,2].includes(value.version)||!uuid(value.installationInstanceId)||!/^[a-f0-9]{64}$/.test(value.salt)||!Number.isSafeInteger(value.revision)||value.revision<0||!Number.isSafeInteger(value.nextRenderId)||value.nextRenderId<1||!(value.lastEventAt===null||date(value.lastEventAt))||!Array.isArray(value.records)||value.records.length>maxRecords||!Array.isArray(value.timeline)||value.timeline.length>100)throw safeError();
  const ids=new Set(),actors=new Set(),keys=new Set();
  for(const r of value.records){
   if(!only(r,['key','actor','endedAt','executionKey','retiredExecutions','terminals'])||!/^[a-f0-9]{64}$/.test(r.key)||keys.has(r.key)||!(r.endedAt===null||date(r.endedAt)))throw safeError();keys.add(r.key);
   if(value.version===2&&(!(r.executionKey===null||/^[a-f0-9]{64}$/.test(r.executionKey))||!Array.isArray(r.retiredExecutions)||r.retiredExecutions.length>64||!r.retiredExecutions.every(k=>/^[a-f0-9]{64}$/.test(k))||!Array.isArray(r.terminals)||r.terminals.length>64||!r.terminals.every(t=>only(t,['generation','endedAt'])&&Number.isSafeInteger(t.generation)&&t.generation>=1&&t.generation<=64&&date(t.endedAt))))throw safeError();
   const a=r.actor;if(a===null){if(!r.endedAt)throw safeError();continue;}
   if(!only(a,['actorId','renderId','palette','generation','status','kind','lastTool','observedAt','lastEventAt'])||!uuid(a.actorId)||actors.has(a.actorId)||!Number.isSafeInteger(a.renderId)||a.renderId<1||a.renderId>=value.nextRenderId||ids.has(a.renderId)||!Number.isInteger(a.palette)||a.palette<0||a.palette>5||(!Number.isSafeInteger(a.generation)||a.generation<1||a.generation>64)||!states.has(a.status)||!kinds.has(a.kind)||!(a.lastTool===null||tools.has(a.lastTool))||!date(a.observedAt)||!date(a.lastEventAt))throw safeError();
   if(value.version===1&&a.generation!==1)throw safeError();
   if(value.version===2){const generations=r.terminals.map(t=>t.generation);if(new Set(generations).size!==generations.length||generations.some((g,i)=>g>a.generation||(i>0&&g<=generations[i-1]))||new Set(r.retiredExecutions).size!==r.retiredExecutions.length||r.retiredExecutions.includes(r.executionKey)||r.retiredExecutions.length>=a.generation||(r.endedAt?(r.terminals.at(-1)?.generation!==a.generation||r.terminals.at(-1)?.endedAt!==r.endedAt):generations.includes(a.generation)))throw safeError();}
   ids.add(a.renderId);actors.add(a.actorId);
  }
  for(const e of value.timeline)if(!only(e,['revision','actorId','generation','tool','startSource','endReason','kind','status','at'])||!Number.isSafeInteger(e.revision)||e.revision<1||e.revision>value.revision||!uuid(e.actorId)||!kinds.has(e.kind)||!(states.has(e.status)||e.status==='session-ended')||!date(e.at)||!(e.generation===undefined||(Number.isSafeInteger(e.generation)&&e.generation>=1&&e.generation<=64))||!(e.startSource===undefined||e.startSource===null||['startup','resume','compact','clear','fork'].includes(e.startSource))||!(e.endReason===undefined||e.endReason===null||['exit','clear','resume','logout','other','prompt_input_exit'].includes(e.endReason))||!(e.tool===undefined||e.tool===null||tools.has(e.tool)))throw safeError();
  if(value.version===2&&value.records.reduce((n,r)=>n+r.terminals.length,0)>maxRecords)throw safeError();
  if(value.records.filter(r=>r.actor&&!r.endedAt).length>maxSessions)throw safeError();
 };
 let failed=false;
 const persist=next=>{
  const temporary=path.join(directory,`.orbit-${randomUUID()}.tmp`);
  try{
   writePrivateExclusive(temporary,next);
   const fd=fs.openSync(temporary,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   fs.renameSync(temporary,file);
   if(process.platform!=='win32'){const dir=fs.openSync(directory,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
  }catch{failed=true;throw safeError();}
  finally{try{fs.unlinkSync(temporary);}catch{ /* only our private temporary file */ }}
 };
 if(fs.existsSync(file)){
  const stat=assertPrivate(file);if(stat.size>2*1024*1024)throw safeError();
  try{const value=JSON.parse(fs.readFileSync(file,'utf8'));validate(value);
   if(value.version===1){value.version=2;for(const r of value.records){r.executionKey=null;r.retiredExecutions=[];r.terminals=r.endedAt?[{generation:r.actor?.generation??1,endedAt:r.endedAt}]:[];}}
   state=value;}catch{throw safeError();}
 }else persist(state);
 const restored=new Set(state.records.filter(r=>r.actor&&!r.endedAt).map(r=>r.actor.actorId));
 const deltas=[];
 const check=()=>{if(failed)throw safeError();};
 const actorView=a=>({...a,providerId:'claude',installationInstanceId:state.installationInstanceId,source,environment,name:`Claude · ${String(a.renderId).padStart(3,'0')}`,restored:restored.has(a.actorId)});
 const tombstone=(r,t={generation:r.actor?.generation??1,endedAt:r.endedAt})=>({actorId:r.actor?.actorId??null,generation:t.generation,endedAt:t.endedAt});
 const cursor=()=>`${epoch}:${state.revision}`;
 return {
  apply(normalized){
   check();
   const {sessionId,kind,awaitingInput,failure,tool,executionId,executionStartedAt,startSource,endReason}=normalized;
   if(!kinds.has(kind))throw safeError();
   const key=createHmac('sha256',state.salt).update(JSON.stringify(['claude',state.installationInstanceId,sessionId,1])).digest('hex');
   const previous=state.records.find(r=>r.key===key);
   const executionKey=executionId?createHmac('sha256',state.salt).update(executionId).digest('hex'):null;
   const reopening=Boolean(previous?.endedAt&&previous.actor&&executionKey&&executionKey!==previous.executionKey&&kind==='sessionStart'&&startSource==='resume'&&!previous.retiredExecutions.includes(executionKey)&&Number.isFinite(executionStartedAt)&&executionStartedAt>Date.parse(previous.endedAt));
   if(previous?.endedAt&&!reopening)return {accepted:true,reason:'terminal-session'};
   if(reopening&&(previous.actor.generation>=64||state.records.filter(r=>r.actor&&!r.endedAt).length>=maxSessions))throw Object.assign(Error('Live generation capacity reached'),{statusCode:429});
   if(previous&&!previous.endedAt){
    if(previous.executionKey!==executionKey)return {accepted:false,reason:'execution-mismatch'};
    if(kind==='sessionStart'&&['clear','fork'].includes(startSource))return {accepted:false,reason:'new-native-id-required'};
    if(kind==='sessionStart'&&startSource!=='compact'&&!restored.has(previous.actor.actorId))return {accepted:true,reason:'duplicate-start'};
   }
   if(!previous&&kind!=='sessionStart'&&kind!=='sessionEnd')return {accepted:true,reason:'start-not-observed'};
   if(!previous&&(state.records.length>=maxRecords||(kind==='sessionStart'&&state.records.filter(r=>r.actor&&!r.endedAt).length>=maxSessions)))throw Object.assign(Error('Live capacity reached'),{statusCode:429});
   if(kind==='sessionEnd'&&state.records.reduce((n,r)=>n+r.terminals.length,0)>=maxRecords)throw Object.assign(Error('Live terminal capacity reached'),{statusCode:429});
   const next=structuredClone(state),at=now();next.revision++;next.lastEventAt=at;
   let record=next.records.find(r=>r.key===key);
   if(!record){record={key,actor:null,endedAt:null,executionKey,retiredExecutions:[],terminals:[]};next.records.push(record);}
   if(reopening){
    if(record.executionKey)record.retiredExecutions.push(record.executionKey);
    record.executionKey=executionKey;record.endedAt=null;record.actor.generation++;record.actor.lastTool=null;
   }
   if(kind==='sessionStart'&&!record.actor){
    if(next.nextRenderId>=Number.MAX_SAFE_INTEGER)throw safeError();
    const id=next.nextRenderId++;record.actor={actorId:randomUUID(),renderId:id,palette:(id-1)%6,generation:1,status:'observed',kind,lastTool:null,observedAt:at,lastEventAt:at};
   }
   const a=record.actor;
   if(kind==='sessionEnd'){record.endedAt=at;record.terminals.push({generation:a?.generation??1,endedAt:at});}
   else if(a){
    a.kind=kind;a.lastEventAt=at;
    if(tool&&tools.has(tool))a.lastTool=tool;
    if(kind==='sessionStart')a.status='observed';
    else if(failure)a.status='tool-failed';
    else if(kind==='toolStart')a.status='working';
    else if(kind==='toolEnd')a.status='between-tools';
    else if(kind==='permissionRequest')a.status='approval';
    else if(kind==='turnEnd')a.status=awaitingInput?'waiting-input':'turn-ended';
    // Subagent observations do not invent child identities or parent status.
   }
   const event=a?{revision:next.revision,actorId:a.actorId,generation:a.generation,tool:kind==='toolStart'&&tools.has(tool)?tool:null,startSource:kind==='sessionStart'&&['startup','resume','compact','clear','fork'].includes(startSource)?startSource:null,endReason:kind==='sessionEnd'&&['exit','clear','resume','logout','other','prompt_input_exit'].includes(endReason)?endReason:null,kind,status:record.endedAt?'session-ended':a.status,at}:null;
   if(event)next.timeline=[event,...next.timeline].slice(0,100);
   persist(next);state=next;if(a)restored.delete(a.actorId);
   const delta={revision:state.revision,upsert:record.endedAt?null:actorView(a),tombstone:record.endedAt?tombstone(record):null,event};
   deltas.push(delta);if(deltas.length>deltaLimit)deltas.shift();
   return {accepted:true};
  },
  snapshot(){check();return {ready:true,epoch,revision:state.revision,cursor:cursor(),source,validation:'unverified-on-real-environment',installationInstanceId:state.installationInstanceId,receivedAt:now(),lastEventAt:state.lastEventAt,actors:state.records.filter(r=>r.actor&&!r.endedAt).map(r=>actorView(r.actor)),tombstones:state.records.flatMap(r=>r.terminals.map(t=>tombstone(r,t))),timeline:state.timeline};},
  changes(after){
   check();const prefix=`${epoch}:`,raw=typeof after==='string'&&after.startsWith(prefix)?after.slice(prefix.length):'';
   const revision=/^(0|[1-9][0-9]*)$/.test(raw)?Number(raw):-1;
   const resetRequired=!Number.isSafeInteger(revision)||revision<0||revision>state.revision||revision<(deltas[0]?.revision??state.revision+1)-1;
   return {ready:true,epoch,revision:state.revision,cursor:cursor(),source,receivedAt:now(),resetRequired,deltas:resetRequired?[]:deltas.filter(d=>d.revision>revision)};
  },
  // Verified-relay lookup. The proof is compared through the same HMAC the
  // receiver already applied to live Claude executions; raw OS identifiers
  // are never returned.
  matchExecution(proof){
   check();
   if(!proof||typeof proof!=='object'||Array.isArray(proof)||Object.keys(proof).sort().join()!=='birth,pid,version'||proof.version!==1||!Number.isSafeInteger(proof.pid)||proof.pid<=1||typeof proof.birth!=='string'||proof.birth.length<1||proof.birth.length>80)return null;
   const executionKey=createHmac('sha256',state.salt).update(JSON.stringify([process.platform,proof.pid,proof.birth])).digest('hex');
   const record=state.records.find(r=>r.executionKey===executionKey||r.retiredExecutions.includes(executionKey));
   if(!record||!record.actor)return null;
   return {name:`Claude · ${String(record.actor.renderId).padStart(3,'0')}`,recordKey:record.key};
  }
 };
}
