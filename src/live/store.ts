export const liveStatuses=['observed','working','approval','waiting-input','turn-ended','between-tools','tool-failed','unknown'] as const;
export type LiveStatus=typeof liveStatuses[number];
export const liveKinds=['sessionStart','sessionEnd','toolStart','toolEnd','permissionRequest','turnEnd','subagentStart','subagentEnd','subagentTurnEnd'] as const;
export const liveTools=['Read','Grep','Glob','Edit','Write','Bash','WebFetch','WebSearch','Agent','Task','AskUserQuestion','Other'] as const;
export type LiveTool=typeof liveTools[number];
export type LiveSource='live'|'fixture';
export interface LiveActor {actorId:string;renderId:number;palette:number;generation:number;providerId:'claude'|'omp';quality?:'contiguous'|'inconsistent-tools'|'sequence-gap'|'gap-expired';modelFamily?:'deepseek'|'other'|'unknown';modelProvider?:'commandcode'|'deepseek'|'other'|'unknown';installationInstanceId:string;source:LiveSource;environment:string;name:string;status:LiveStatus;kind:typeof liveKinds[number];lastTool:LiveTool|null;observedAt:string;lastEventAt:string;receivedAt?:string;restored:boolean;delegatedBy?:{name:string}|null}
export interface LiveEvent {revision:number;actorId:string;kind:typeof liveKinds[number];status:LiveStatus|'session-ended';at:string;generation?:number;tool?:LiveTool|null}
export interface Tombstone {actorId:string|null;generation?:number;endedAt:string}
export interface LiveSnapshot {ready:true;providerId?:'claude'|'omp';epoch:string;revision:number;cursor:string;source:LiveSource;installationInstanceId:string;receivedAt:string;lastEventAt:string|null;actors:LiveActor[];tombstones:Tombstone[];timeline:LiveEvent[]}
export interface LiveDelta {revision:number;upsert:LiveActor|null;tombstone:Tombstone|null;event:LiveEvent|null}
export interface LiveChanges {ready:true;epoch:string;revision:number;cursor:string;source:LiveSource;receivedAt:string;resetRequired:boolean;deltas:LiveDelta[]}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
const timestamp=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const member=<T extends string>(set:readonly T[],v:unknown):v is T=>typeof v==='string'&&set.includes(v as T);
const source=(v:unknown):v is LiveSource=>v==='live'||v==='fixture';
function actor(v:unknown):v is LiveActor{return object(v)&&uuid(v.actorId)&&integer(v.renderId)&&v.renderId>0&&integer(v.palette)&&v.palette<6&&integer(v.generation)&&v.generation>0&&(v.providerId==='claude'||v.providerId==='omp')&&uuid(v.installationInstanceId)&&source(v.source)&&member(liveStatuses,v.status)&&member(liveKinds,v.kind)&&(v.lastTool===null||member(liveTools,v.lastTool))&&timestamp(v.observedAt)&&timestamp(v.lastEventAt)&&(v.receivedAt===undefined||timestamp(v.receivedAt))&&typeof v.restored==='boolean'&&typeof v.environment==='string'&&/^(linux|darwin|win32)\/(x64|arm64)( · WSL)?$/.test(v.environment)&&v.name===`${v.providerId==='omp'?'OMP':'Claude'} · ${String(v.renderId).padStart(3,'0')}`&&(v.providerId==='claude'||(member(['contiguous','inconsistent-tools','sequence-gap','gap-expired'],v.quality)&&member(['deepseek','other','unknown'],v.modelFamily)&&member(['commandcode','deepseek','other','unknown'],v.modelProvider)))&&(v.delegatedBy===undefined||v.delegatedBy===null||(object(v.delegatedBy)&&typeof v.delegatedBy.name==='string'&&/^Claude · [0-9]{3}$/.test(v.delegatedBy.name)));}
const tomb=(v:unknown):v is Tombstone=>object(v)&&(v.actorId===null||uuid(v.actorId))&&timestamp(v.endedAt)&&(v.generation===undefined||(integer(v.generation)&&v.generation>0));
const event=(v:unknown):v is LiveEvent=>object(v)&&integer(v.revision)&&v.revision>0&&uuid(v.actorId)&&member(liveKinds,v.kind)&&(v.status==='session-ended'||member(liveStatuses,v.status))&&timestamp(v.at)&&(v.generation===undefined||(integer(v.generation)&&v.generation>0))&&(v.tool===undefined||v.tool===null||member(liveTools,v.tool));
const envelope=(v:unknown):v is Record<string,unknown>=>object(v)&&v.ready===true&&uuid(v.epoch)&&integer(v.revision)&&v.cursor===`${v.epoch}:${v.revision}`&&source(v.source)&&timestamp(v.receivedAt);
export function parseSnapshot(v:unknown):LiveSnapshot{
 if(!envelope(v)||!uuid(v.installationInstanceId)||!(v.lastEventAt===null||timestamp(v.lastEventAt))||!Array.isArray(v.actors)||v.actors.length>100||!v.actors.every(actor)||!Array.isArray(v.tombstones)||v.tombstones.length>1000||!v.tombstones.every(tomb)||!Array.isArray(v.timeline)||v.timeline.length>100||!v.timeline.every(event))throw Error('Invalid live snapshot');
 const a=v.actors as LiveActor[];
 if(v.providerId!==undefined&&v.providerId!=='claude'&&v.providerId!=='omp')throw Error('Invalid live provider');
 if(a.some(a=>a.providerId!==(v.providerId??'claude')))throw Error('Invalid live provider namespace');
 if(new Set(a.map(a=>a.providerId)).size>1)throw Error('Mixed live providers');
 if(new Set(a.map(a=>a.actorId)).size!==a.length||new Set(a.map(a=>a.renderId)).size!==a.length||a.some(a=>a.source!==v.source||a.installationInstanceId!==v.installationInstanceId))throw Error('Invalid live namespace');
 return v as unknown as LiveSnapshot;
}
export function parseChanges(v:unknown):LiveChanges{
 if(!envelope(v)||typeof v.resetRequired!=='boolean'||!Array.isArray(v.deltas)||v.deltas.length>128||!v.deltas.every(d=>object(d)&&integer(d.revision)&&(d.upsert===null||actor(d.upsert))&&(d.tombstone===null||tomb(d.tombstone))&&(d.event===null||event(d.event))))throw Error('Invalid live changes');
 return v as unknown as LiveChanges;
}
export function applySnapshot(previous:LiveSnapshot|null,next:LiveSnapshot):LiveSnapshot{
 if(previous?.epoch===next.epoch&&(previous.providerId??'claude')!==(next.providerId??'claude'))throw Error('Live provider changed within epoch');
 if(previous?.epoch===next.epoch&&next.revision<previous.revision)return previous;
 const tombstones=previous?.epoch===next.epoch?[...previous.tombstones,...next.tombstones]:next.tombstones;
 const ended=new Map<string|null,number>();for(const t of tombstones)ended.set(t.actorId,Math.max(ended.get(t.actorId)??0,t.generation??1));
 return {...next,tombstones:[...new Map(tombstones.map(t=>[`${t.actorId??t.endedAt}:${t.generation??1}`,t])).values()],actors:next.actors.filter(a=>a.generation>(ended.get(a.actorId)??0))};
}
export function applyChanges(current:LiveSnapshot,response:LiveChanges):LiveSnapshot|null{
 if(response.resetRequired||response.epoch!==current.epoch||response.source!==current.source)return null;
 if(response.revision<current.revision)return current;
 const changes=response.deltas.filter(d=>d.revision>current.revision);
 let revision=current.revision;
 for(const d of changes){if(d.revision!==revision+1)return null;revision=d.revision;}
 if(revision!==response.revision)return null;
 const actors=new Map(current.actors.map(a=>[a.actorId,a])),tombstones=[...current.tombstones],timeline=[...current.timeline];
 const ended=new Map<string|null,number>();for(const t of tombstones)ended.set(t.actorId,Math.max(ended.get(t.actorId)??0,t.generation??1));
 for(const d of changes){
  if(d.tombstone){tombstones.push(d.tombstone);ended.set(d.tombstone.actorId,Math.max(ended.get(d.tombstone.actorId)??0,d.tombstone.generation??1));if(d.tombstone.actorId&&(actors.get(d.tombstone.actorId)?.generation??0)<=(d.tombstone.generation??1))actors.delete(d.tombstone.actorId);}
  if(d.upsert&&d.upsert.generation>(ended.get(d.upsert.actorId)??0)&&(actors.get(d.upsert.actorId)?.generation??0)<=d.upsert.generation){
   if(d.upsert.providerId!==(current.providerId??'claude')||d.upsert.source!==current.source||d.upsert.installationInstanceId!==current.installationInstanceId||[...actors.values()].some(a=>a.actorId!==d.upsert!.actorId&&a.renderId===d.upsert!.renderId))return null;
   actors.set(d.upsert.actorId,d.upsert);
  }
  if(d.event)timeline.unshift(d.event);
 }
 return {...current,revision,cursor:response.cursor,receivedAt:response.receivedAt,lastEventAt:changes.length?response.receivedAt:current.lastEventAt,actors:[...actors.values()],tombstones,timeline:[...new Map(timeline.map(e=>[e.revision,e])).values()].slice(0,100)};
}
export function freshness(actor:LiveActor,now:number,transportOffline=false){return transportOffline||now-Date.parse(actor.lastEventAt)>120000?'offline':actor.restored||(actor.quality!==undefined&&actor.quality!=='contiguous')||now-Date.parse(actor.lastEventAt)>30000?'stale':'fresh';}
export interface OmpOutboxStatus{prepared:boolean;enrolled:boolean;pending:number;retainedRuns:number;capacityRemaining:number;blockedRuns:number;installationMismatch:boolean;registry:'missing'|'alive'|'stale';writers:{run:string;pid:number;alive:boolean}[];lastRejection:{at:string;statusCode:number}|null;recoveryRequired:boolean}
export function parseOmpOutboxStatus(v:unknown):OmpOutboxStatus{
 if(!object(v)||typeof v.prepared!=='boolean'||typeof v.enrolled!=='boolean')throw Error('Invalid OMP outbox status');
 if(!integer(v.pending)||!integer(v.retainedRuns)||!integer(v.capacityRemaining)||v.capacityRemaining>1024||!integer(v.blockedRuns)||typeof v.installationMismatch!=='boolean'||typeof v.recoveryRequired!=='boolean')throw Error('Invalid OMP outbox counts');
 if(v.registry!=='missing'&&v.registry!=='alive'&&v.registry!=='stale')throw Error('Invalid OMP outbox registry');
 if(!Array.isArray(v.writers)||v.writers.length>1024||!v.writers.every(w=>object(w)&&typeof w.run==='string'&&/^run-\d{4}$/.test(w.run)&&integer(w.pid)&&w.pid>0&&typeof w.alive==='boolean'))throw Error('Invalid OMP outbox writers');
 if(v.lastRejection!==null&&(!object(v.lastRejection)||!timestamp(v.lastRejection.at)||!integer(v.lastRejection.statusCode)||v.lastRejection.statusCode<400||v.lastRejection.statusCode>=500))throw Error('Invalid OMP outbox rejection');
 return v as unknown as OmpOutboxStatus;
}
export const liveLabels:Record<LiveStatus|'session-ended',string>={observed:'세션 시작 관찰',working:'도구 실행 중',approval:'승인 요청','waiting-input':'사용자 입력 대기','turn-ended':'턴 종료 · 업무 결과 미확정','between-tools':'도구 종료 · 다음 상태 미확인','tool-failed':'도구 실패',unknown:'상태 미확인','session-ended':'세션 종료'};
