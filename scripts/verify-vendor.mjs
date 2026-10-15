import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export const root=fileURLToPath(new URL('../',import.meta.url));
export function verifyVendor(){
 const lock=JSON.parse(fs.readFileSync(path.join(root,'vendor/upstream-lock.json'),'utf8'));
 if(lock.commit!=='d1e007a9fdf3003c252d2973abe1999ae59aec33')throw Error('Unexpected upstream identity');
 for(const [name,hash] of Object.entries(lock.files)){
  const actual=createHash('sha256').update(fs.readFileSync(path.join(root,'vendor/pixel-agents',name))).digest('hex');
  if(actual!==hash)throw Error(`Vendored upstream changed: ${name}`);
 }
 return {commit:lock.commit,files:Object.keys(lock.files).length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifyVendor()));
