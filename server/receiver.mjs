import {fork} from 'node:child_process';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {sanitizeClaude} from './claude-input.mjs';
export function makeReceiver({source='live',maxSessions=100}={}){
 const token=randomBytes(32).toString('hex'),sessions=new Map();
 let worker=null,requestId=0,lastEventAt=null,sequence=0;
 const pending=new Map();
 const failPending=()=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(Error('worker unavailable'));}pending.clear();};
 const start=()=>{
  if(worker?.connected)return worker;
  worker=fork(fileURLToPath(new URL('../dist/claude-worker.cjs',import.meta.url)),[],{stdio:['ignore','ignore','ignore','ipc']});
  worker.on('message',message=>{
   const entry=pending.get(message.requestId);if(!entry)return;clearTimeout(entry.timer);pending.delete(message.requestId);
   if(message.error)entry.reject(Error('normalization failed'));else entry.resolve(message);
  });
  worker.on('error',failPending);worker.on('exit',()=>{worker=null;failPending();});return worker;
 };
 return {
  token,
  authorized(header){const a=Buffer.from(header??''),b=Buffer.from(`Bearer ${token}`);return a.length===b.length&&timingSafeEqual(a,b);},
  async receive(providerId,body){
   if(providerId!=='claude')throw Object.assign(Error('unsupported provider'),{statusCode:404});
   const raw=sanitizeClaude(body);
   if(pending.size>=64)throw Object.assign(Error('receiver busy'),{statusCode:429});
   const child=start(),id=++requestId;
   const normalized=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('worker timeout'));},2000);
    pending.set(id,{resolve,reject,timer});child.send({requestId:id,raw});
   });
   if(!normalized.normalized)return {accepted:false,reason:'ignored-by-provider'};
   const {sessionId,kind,awaitingInput}=normalized.normalized;
   const sessionKey=createHash('sha256').update(JSON.stringify(['claude',sessionId])).digest('hex').slice(0,24);
   const previous=sessions.get(sessionKey);const at=new Date().toISOString();
   // Preserve uncertainty: a tool start isn't proof of coding/analysis,
   // and Stop is a turn end, not proof that an overall task succeeded.
   const status=normalized.failure?'tool-failed':kind==='toolStart'?'working':kind==='permissionRequest'?'approval':kind==='turnEnd'?(awaitingInput?'waiting-input':'turn-ended'):kind==='sessionEnd'?'session-ended':kind==='sessionStart'?'observed':kind==='toolEnd'?'between-tools':previous?.status??'unknown';
   if(!previous&&sessions.size>=maxSessions)throw Object.assign(Error('session capacity'),{statusCode:429});
   sessions.set(sessionKey,{sessionKey,providerId:'claude',name:`Claude · ${sessionKey.slice(0,6)}`,source,kind,status,lastEventAt:at,sequence:++sequence});lastEventAt=at;
   return {accepted:true};
  },
  snapshot(){return {source,validation:'unverified-on-real-mac',lastEventAt,sequence,sessions:[...sessions.values()]};},
  async close(){failPending();if(worker){const child=worker;worker=null;child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}}
 };
}
