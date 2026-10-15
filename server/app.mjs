import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import {fileURLToPath} from 'node:url';
const app=Fastify({logger:false});
app.get('/api/health',()=>({status:'ok',mode:'mock-only',providersConnected:0}));
await app.register(staticFiles,{root:fileURLToPath(new URL('../dist/',import.meta.url))});
await app.listen({host:'127.0.0.1',port:Number(process.env.PORT??4173)});
console.log('Orbit Works standalone ready (loopback, mock only).');
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{void app.close();});
