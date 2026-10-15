import {fork,spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {root} from './verify-vendor.mjs';
import {stopOwnedChild} from '../platform/runtime.mjs';
const server=fork(fileURLToPath(new URL('../server/app.mjs',import.meta.url)),[],{cwd:root,env:{...process.env,PORT:'0',ORBIT_MODE:'mock'},stdio:['ignore','ignore','ignore','ipc']});
try{
 const [ready]=await once(server,'message',{signal:AbortSignal.timeout(20000)});
 const check=spawn(process.execPath,[fileURLToPath(new URL('./browser-check.mjs',import.meta.url))],{cwd:root,env:{...process.env,ORBIT_BASE_URL:`http://127.0.0.1:${ready.port}`},stdio:'inherit',shell:false});
 const [code]=await once(check,'exit');process.exitCode=code??1;
}finally{await stopOwnedChild(server);}
