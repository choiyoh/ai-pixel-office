import {fork} from 'node:child_process';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {stopOwnedChild} from '../platform/runtime.mjs';
import {sanitizeClaude} from './claude-input.mjs';
import {openLiveProjection} from './live-projection.mjs';
export function makeReceiver({source='live',maxSessions=100}={}){
 const token=randomBytes(32).toString('hex');
 let worker=null,requestId=0,projection=null,queue=Promise.resolve(),queued=0,closed=false;
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
  initialize(options){if(projection)throw Error('Receiver already initialized');projection=openLiveProjection({...options,source,maxSessions});},
  authorized(header){const a=Buffer.from(header??''),b=Buffer.from(`Bearer ${token}`);return a.length===b.length&&timingSafeEqual(a,b);},
  async receive(providerId,body){
   if(providerId!=='claude')throw Object.assign(Error('unsupported provider'),{statusCode:404});
   const raw=sanitizeClaude(body);
   if(!projection||closed)throw Object.assign(Error('receiver unavailable'),{statusCode:503});
   if(queued>=64)throw Object.assign(Error('receiver busy'),{statusCode:429});
   queued++;
   const operation=queue.then(async()=>{
    if(closed)throw Error('receiver closed');
    const child=start(),id=++requestId;
    const normalized=await new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>{pending.delete(id);reject(Error('worker timeout'));},2000);
     pending.set(id,{resolve,reject,timer});child.send({requestId:id,raw});
    });
    if(!normalized.normalized)return {accepted:false,reason:'ignored-by-provider'};
    if(closed)throw Error('receiver closed');
    return projection.apply(normalized.normalized);
   });
   queue=operation.catch(()=>{});
   try{return await operation;}finally{queued--;}
  },
  liveSnapshot(){if(!projection)throw Error('receiver not ready');return projection.snapshot();},
  changes(cursor){if(!projection)throw Error('receiver not ready');return projection.changes(cursor);},
  snapshot(){
   const data=projection?.snapshot();
   return {source,validation:'unverified-on-real-environment',lastEventAt:data?.lastEventAt??null,sequence:data?.revision??0,sessions:(data?.actors??[]).map(a=>({...a,sessionKey:a.actorId,sequence:data.revision}))};
  },
  async close(){closed=true;failPending();await queue;if(worker){const child=worker;worker=null;await stopOwnedChild(child);}}
 };
}
