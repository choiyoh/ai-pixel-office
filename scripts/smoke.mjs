import {fork} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import {root} from './verify-vendor.mjs';
import {stopOwnedChild} from '../platform/runtime.mjs';
const child=fork(fileURLToPath(new URL('../server/app.mjs',import.meta.url)),[],{env:{...process.env,ORBIT_MODE:'mock',PORT:'0'},stdio:['ignore','ignore','ignore','ipc']});
try{
 const [ready]=await once(child,'message',{signal:AbortSignal.timeout(20000)});
 if(ready.type!=='orbit:ready')throw Error('Unexpected startup');
 const url=`http://127.0.0.1:${ready.port}`;
 const health=await (await fetch(url+'/api/health')).json();
 if(health.mode!=='mock-only'||health.realEnvironmentVerified!==false)throw Error('Wrong mode');
 const response=await fetch(url);if(!(await response.text()).includes('<html'))throw Error('Missing SPA');
 const cookie=response.headers.get('set-cookie').split(';')[0];
 const events=await (await fetch(url+'/api/events',{headers:{cookie}})).json();if(events.source!=='mock'||events.sessions.length!==0)throw Error('Unexpected live data');
 const assets=await (await fetch(url+'/engine-assets.json')).json();if(assets.characters.length!==6)throw Error('Missing characters');
 await stopOwnedChild(child);
 let stopped=false;try{await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)});}catch{stopped=true;}
 if(!stopped)throw Error('Server did not stop');
 fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts/platform-smoke.json'),JSON.stringify({status:'passed',platform:process.platform,arch:process.arch,mode:'mock',startup:true,shutdown:'IPC',realEnvironmentVerified:false},null,2));
 console.log('Mock server startup, assets, isolation, and graceful IPC shutdown passed.');
}finally{await stopOwnedChild(child);}
