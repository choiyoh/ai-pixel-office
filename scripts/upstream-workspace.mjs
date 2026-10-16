import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {root,verifyVendor} from './verify-vendor.mjs';

export function applyWindowsTestFixtures(workspace){
 const canonical=value=>process.platform==='win32'?value.toLowerCase():value;
 const protectedRoot=canonical(fs.realpathSync(path.join(root,'vendor/pixel-agents'))),targetRoot=canonical(fs.realpathSync(workspace));
 if(targetRoot===protectedRoot||targetRoot.startsWith(protectedRoot+path.sep))throw Error('Fixture overlay refuses the protected vendor tree');
 const lock=JSON.parse(fs.readFileSync(path.join(root,'vendor/upstream-lock.json'),'utf8'));
 const overlay=JSON.parse(fs.readFileSync(path.join(root,'patches/windows-upstream-test-fixtures.json'),'utf8'));
 if(overlay.upstream!==lock.commit)throw Error('Upstream fixture version mismatch');
 const prepared=[];
 for(const entry of overlay.patches){
  if(!/^server\/__tests__\/[A-Za-z0-9_.-]+\.test\.ts$/.test(entry.file))throw Error('Fixture overlay must target test files only');
  const file=path.join(workspace,entry.file),original=fs.readFileSync(file,'utf8');
  const real=canonical(fs.realpathSync(file));
  if(!real.startsWith(targetRoot+path.sep)||fs.lstatSync(file).isSymbolicLink())throw Error('Fixture overlay refuses paths outside its temporary workspace');
  if(createHash('sha256').update(original).digest('hex')!==lock.files[entry.file])throw Error('Upstream fixture source drift');
  let updated=original;
  for(const edit of entry.replacements){
   if(updated.split(edit.before).length-1!==edit.count)throw Error('Upstream fixture patch count mismatch');
   updated=updated.replaceAll(edit.before,edit.after);
  }
  prepared.push({file,updated});
 }
 // Validate every patch before writing any fixture. Never write vendor paths.
 for(const entry of prepared)fs.writeFileSync(entry.file,entry.updated);
 return overlay.patches.map(entry=>path.basename(entry.file));
}

export function createUpstreamWorkspace(parent,{windows=process.platform==='win32'}={}){
 verifyVendor();
 const source=path.join(root,'vendor/pixel-agents'),destination=path.join(parent,'source');
 const lock=JSON.parse(fs.readFileSync(path.join(root,'vendor/upstream-lock.json'),'utf8'));
 for(const name of Object.keys(lock.files)){
  const file=path.join(destination,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(path.join(source,name),file);
 }
 for(const name of ['node_modules','server/node_modules','webview-ui/node_modules']){
  const target=path.join(source,name);if(fs.existsSync(target))fs.symlinkSync(target,path.join(destination,name),'junction');
 }
 const patched=windows?applyWindowsTestFixtures(destination):[];
 return {directory:destination,patched};
}
