import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import {stateRoot as getStateRoot,runtimeInfo} from '../platform/runtime.mjs';
import {ensurePrivateDirectory,writePrivateExclusive} from '../platform/private-files.mjs';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {makeReceiver} from './receiver.mjs';
import {readOmpOffice} from '../platform/omp-office-reader.mjs';
import {readOmpOutboxStatus} from '../platform/omp-outbox.mjs';

export async function createApp({mode='mock',source='live',stateDir,environment=runtimeInfo().environment}={}){
 if(!['mock','claude-local'].includes(mode))throw Error('Unsupported ORBIT_MODE');
 const app=Fastify({logger:false,bodyLimit:65536});
 const receiver=mode==='claude-local'?makeReceiver({source}):null;
 app.setErrorHandler((error,request,reply)=>{reply.code(error.statusCode===413?413:503).send({error:error.statusCode===413?'body-too-large':'service-unavailable'});});
 const cookieSecret=randomBytes(32).toString('hex');
 let registry=null,registryOwned=false;
 app.addHook('onRequest',async(request,reply)=>{
  const host=request.headers.host;
  if(!host||!/^((127\.0\.0\.1)|(localhost))(:\d+)?$/.test(host))return reply.code(403).send({error:'loopback-host-required'});
  if(request.headers.origin&&request.headers.origin!==`http://${host}`)return reply.code(403).send({error:'same-origin-required'});
  if(request.method==='GET'&&(request.url==='/'||request.url.startsWith('/?'))){reply.header('set-cookie',`orbit_session=${cookieSecret}; HttpOnly; SameSite=Strict; Path=/`);}
  reply.header('x-content-type-options','nosniff');reply.header('referrer-policy','no-referrer');
  if(request.url.startsWith('/api/'))reply.header('cache-control','no-store');
  if(['/api/connection','/api/events','/api/live/snapshot','/api/live/events','/api/omp/snapshot','/api/omp/outbox'].includes(request.routeOptions.url)){
   const candidate=(request.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('orbit_session='))?.slice(14)??'';
   const a=Buffer.from(candidate),b=Buffer.from(cookieSecret);
   if(a.length!==b.length||!timingSafeEqual(a,b))return reply.code(401).send({error:'local-session-required'});
  }
 });
 app.get('/api/health',()=>({status:'ok',mode:mode==='mock'?'mock-only':'claude-local-prepared',providersConnected:receiver?.snapshot().sessions.length?1:0,realMacVerified:false,realEnvironmentVerified:false}));
 app.get('/api/connection',()=>{
  const snapshot=receiver?.snapshot();
  return {mode,...runtimeInfo(),environment,node:process.versions.node,connection:receiver?(snapshot.lastEventAt?'events-received':'awaiting-events'):'mock-only',source:snapshot?.source??'mock',lastEventAt:snapshot?.lastEventAt??null,realMacVerified:false,realEnvironmentVerified:false};
 });
 app.get('/api/events',()=>receiver?.snapshot()??{source:'mock',validation:'not-live',lastEventAt:null,sequence:0,sessions:[]});
 app.get('/api/live/snapshot',async(request,reply)=>receiver?receiver.liveSnapshot():reply.code(409).send({ready:false,error:'receiver-not-prepared'}));
 app.get('/api/live/events',async(request,reply)=>receiver?receiver.changes(request.query.after):reply.code(409).send({ready:false,error:'receiver-not-prepared'}));
 app.get('/api/omp/snapshot',async(request,reply)=>{
  if(!receiver)return reply.code(409).send({ready:false,error:'receiver-not-prepared'});
  try{return await readOmpOffice({directory:path.join(stateDir??getStateRoot(),'provider-bridge-omp'),source,environment:`${runtimeInfo().platform}/${runtimeInfo().arch}${runtimeInfo().wsl?' · WSL':''}`,resolveDelegation:proof=>receiver?.matchExecution(proof)??null});}catch(e){return reply.code(e.statusCode===409?409:503).send({ready:false,error:e.statusCode===409?'omp-unprepared':'omp-unavailable'});}
 });
 app.get('/api/omp/outbox',async(request,reply)=>{
  try{return {ready:true,...readOmpOutboxStatus({directory:path.join(stateDir??getStateRoot(),'omp-outbox'),bridgeDirectory:path.join(stateDir??getStateRoot(),'provider-bridge-omp')})};}catch{return reply.code(503).send({ready:false,error:'omp-outbox-unavailable'});}
 });
 app.post('/api/hooks/:providerId',async(request,reply)=>{
  if(!receiver)return reply.code(409).send({error:'receiver-disabled-in-mock-mode'});
  if(!receiver.authorized(request.headers.authorization))return reply.code(401).send({error:'unauthorized'});
  try{return await receiver.receive(request.params.providerId,request.body);}catch(error){return reply.code(error.statusCode??422).send({error:error.statusCode===404?'unsupported-provider':'event-not-accepted'});}
 });
 await app.register(staticFiles,{root:fileURLToPath(new URL('../dist/',import.meta.url)),index:['index.html']});
 app.addHook('onClose',async()=>{
  await receiver?.close();
  if(registry){try{const current=JSON.parse(fs.readFileSync(registry,'utf8'));if(current.token===receiver.token)fs.unlinkSync(registry);}catch{ /* no unrelated file removal */ }}
 });
 return {app,async listen(port){
  await app.listen({host:'127.0.0.1',port});
  if(receiver){
   try{
    const stateRoot=stateDir??getStateRoot();
    ensurePrivateDirectory(stateRoot);
    const directory=path.join(stateRoot,'runtime');
    ensurePrivateDirectory(directory);
    registry=path.join(directory,'receiver.json');
    writePrivateExclusive(registry,{port:app.server.address().port,token:receiver.token,pid:process.pid});
    registryOwned=true;
    receiver.initialize({directory:path.join(stateRoot,'live'),environment:`${runtimeInfo().platform}/${runtimeInfo().arch}${runtimeInfo().wsl?' · WSL':''}`});
   }catch(error){if(!registryOwned)registry=null;await app.close();throw error;}
  }
 }};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const instance=await createApp({mode:process.env.ORBIT_MODE??'mock',stateDir:process.env.ORBIT_STATE_DIR});
 await instance.listen(Number(process.env.PORT??4173));
 console.log('Orbit Works ready on loopback. Real OS/Claude validation remains pending.');
 process.send?.({type:'orbit:ready',port:instance.app.server.address().port});
 let closing=false;
 const shutdown=async()=>{if(closing)return;closing=true;await instance.app.close();process.disconnect?.();};
 process.on('message',message=>{if(message?.type==='orbit:shutdown')void shutdown();});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void shutdown();});
}
