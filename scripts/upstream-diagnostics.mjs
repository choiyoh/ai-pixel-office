import fs from 'node:fs';
import path from 'node:path';

export function summarizeUpstream(report,suite){
 const failures=[];
 for(const result of report.testResults??[]){
  const basename=path.win32.basename(path.posix.basename(result.name??''));
  const file=/^[A-Za-z0-9_.-]+\.test\.ts$/.test(basename)?basename:'upstream-suite';
  let source='';try{source=fs.readFileSync(result.name,'utf8');}catch{ /* No path output. */ }
  for(const [index,test] of (result.assertionResults??[]).entries())if(test.status==='failed'){
   // Only literal titles already in the pinned public source may be published.
   const title=String(test.title??'');
   const known=/^[A-Za-z0-9 ()_,.:;!?+-]{1,200}$/.test(title)&&(source.includes("'"+title+"'")||source.includes('"'+title+'"'));
   const message=(test.failureMessages??[]).join('\n').replace(/\x1b\[[0-9;]*m/g,'');
   const errno=message.match(/\b(ENOENT|EPERM|EACCES|EINVAL|ENOSYS|ETIMEDOUT|EADDRINUSE)\b/)?.[1]??null;
   const boolean=message.match(/expected (true|false) to be (true|false)/i);
   failures.push({suite,file,test:known?title:`test-${index+1}`,errno,assertion:message.includes('AssertionError'),actualBoolean:boolean?boolean[1].toLowerCase()==='true':null,expectedBoolean:boolean?boolean[2].toLowerCase()==='true':null});
  }
 }
 return {suite,total:report.numTotalTests??0,passed:report.numPassedTests??0,failed:report.numFailedTests??0,skipped:report.numPendingTests??0,failures};
}
