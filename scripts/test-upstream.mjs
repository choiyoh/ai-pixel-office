import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {root,verifyVendor} from './verify-vendor.mjs';
verifyVendor();
const testHome=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-upstream-test-'));
try{
 for(const args of [['run','compile'],['test']]){
  const result=spawnSync('npm',args,{cwd:path.join(root,'vendor/pixel-agents'),env:{...process.env,HOME:testHome,USERPROFILE:testHome,HUSKY:'0'},stdio:'inherit'});
  if(result.status!==0){process.exitCode=result.status??1;break;}
 }
}finally{fs.rmSync(testHome,{recursive:true,force:true});verifyVendor();}
