import {runNpm} from '../platform/runtime.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {root,verifyVendor} from './verify-vendor.mjs';
import {summarizeUpstream} from './upstream-diagnostics.mjs';
verifyVendor();
const testHome=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-upstream-test-'));
const vendor=path.join(root,'vendor/pixel-agents'),summaries=[];
if(process.env.GITHUB_ACTIONS==='true')console.log(`::notice title=Orbit upstream runtime::${JSON.stringify({platform:process.platform,arch:process.arch,node:process.versions.node})}`);
const env={...process.env,HOME:testHome,USERPROFILE:testHome,HUSKY:'0'};
const phase=(name,args,cwd)=>{
 const result=runNpm(args,{cwd,env,stdio:'inherit'});
 if(result.status!==0){process.exitCode=result.status??1;if(process.env.GITHUB_ACTIONS==='true')console.log(`::error title=Orbit upstream phase failure::${JSON.stringify({phase:name,exitCode:result.status??null})}`);}
 return result.status===0;
};
try{
 if(phase('compile',['run','compile'],vendor)){
  for(const suite of ['webview-ui','server']){
   const output=path.join(testHome,suite+'.json');
   phase(suite,['test','--','--reporter=default','--reporter=json','--outputFile='+output],path.join(vendor,suite));
   if(fs.existsSync(output)){
    const summary=summarizeUpstream(JSON.parse(fs.readFileSync(output,'utf8')),suite);summaries.push(summary);
    if(process.env.GITHUB_ACTIONS==='true'){
     console.log(`::notice title=Orbit upstream suite::${JSON.stringify({suite,total:summary.total,passed:summary.passed,failed:summary.failed,skipped:summary.skipped})}`);
     for(const failure of summary.failures)console.log(`::error title=Orbit upstream test failure::${JSON.stringify(failure)}`);
    }
   }
  }
  phase('package-contract',['run','test:package-contract'],vendor);
 }
 fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts/upstream-summary.json'),JSON.stringify(summaries,null,2));
}finally{fs.rmSync(testHome,{recursive:true,force:true});verifyVendor();}
