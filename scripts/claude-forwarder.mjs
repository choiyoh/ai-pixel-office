import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {sanitizeClaude} from '../server/claude-input.mjs';
// Invoked only by a separately approved settings entry. No installer here.
// Never log stdin/credentials or allow a hook failure to break Claude Code.
async function forward(){
try{
 const chunks=[];let size=0;
 for await(const chunk of process.stdin){size+=chunk.length;if(size>65536)throw Error('too large');chunks.push(chunk);}
 const event=sanitizeClaude(JSON.parse(Buffer.concat(chunks).toString('utf8')));
 const registryPath=path.join(process.env.ORBIT_STATE_DIR??path.join(os.homedir(),'.orbit-works'),'runtime/receiver.json');
 const stat=fs.lstatSync(registryPath);
 if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||(typeof process.getuid==='function'&&stat.uid!==process.getuid()))throw Error('unsafe registry');
 const registry=JSON.parse(fs.readFileSync(registryPath,'utf8'));
 if(!Number.isInteger(registry.port)||registry.port<1||registry.port>65535||typeof registry.token!=='string'||!/^[a-f0-9]{64}$/.test(registry.token))throw Error('bad registry');
 if(!Number.isInteger(registry.pid)||registry.pid<=0)throw Error('bad registry owner');
 process.kill(registry.pid,0); // Best-effort stale-process check; never kill it.
 const body=JSON.stringify(event);
 await new Promise(resolve=>{
  const request=http.request({host:'127.0.0.1',port:registry.port,path:'/api/hooks/claude',method:'POST',headers:{authorization:`Bearer ${registry.token}`,'content-type':'application/json','content-length':Buffer.byteLength(body)},timeout:1500},response=>{response.resume();response.on('end',resolve);});
  request.on('error',resolve);request.on('timeout',()=>request.destroy());request.end(body);
 });
}catch{ /* Fail closed and silent; no user settings or remote endpoints touched. */ }

}
void forward();
