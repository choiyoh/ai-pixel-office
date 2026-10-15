import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {root} from './verify-vendor.mjs';
const result=spawnSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,shell:false,encoding:'utf8'});
if(result.status!==0)throw Error('Cannot enumerate source for delivery check');
const files=[...new Set(result.stdout.split('\0').filter(Boolean))].filter(file=>fs.existsSync(path.join(root,file)));
const identities=new Map(),issues=[];
const patterns=[['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['github-token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],['provider-key',/\bsk-(?:ant-[A-Za-z0-9_-]{30,}|[A-Za-z0-9]{32,})\b/],['aws-access-key',/\bAKIA[A-Z0-9]{16}\b/],['url-password',/https?:\/\/[^\s/@:]+:[^\s/@]+@/]];
for(const file of files){
 const key=file.normalize('NFC').toLowerCase();
 if(identities.has(key)&&identities.get(key)!==file)issues.push({file,kind:'case-collision'});
 identities.set(key,file);
 const bytes=fs.readFileSync(path.join(root,file));if(bytes.includes(0))continue;
 const content=bytes.toString('utf8');for(const [kind,pattern] of patterns)if(pattern.test(content))issues.push({file,kind});
}
fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
const report={status:issues.length?'failed':'passed',files:files.length,checks:['case/Unicode path collision','known credential/private-key patterns'],issues,limitation:'Pattern scan is not proof that all sensitive information is absent. Ignored runtime artifacts are excluded.'};
fs.writeFileSync(path.join(root,'artifacts/source-check.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));if(issues.length)process.exitCode=1;
