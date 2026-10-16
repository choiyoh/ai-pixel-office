import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {windowsAclScript,assertPrivate,ensurePrivateDirectory,writePrivateExclusive} from '../platform/private-files.mjs';
import {powershellInvocation,powerShellDiagnostic,psQuote,runPowerShell} from '../platform/runtime.mjs';

// Mutate test-owned temporary fixtures only; never inspect user settings.
function execute(script,engine='desktop'){
 const invocation=powershellInvocation(script);
 const result=spawnSync(engine==='core'?'pwsh.exe':invocation.command,invocation.args,{shell:false,windowsHide:true,encoding:'utf8',timeout:15000});
 if(result.error||result.status!==0){
  const diagnostic=powerShellDiagnostic(result);
  // Job summaries are visible without exposing raw PowerShell stderr/paths.
  if(process.env.CI&&process.env.GITHUB_STEP_SUMMARY){
   try{fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\n### Windows ACL fixture (${engine})\n\n\`\`\`json\n${JSON.stringify(diagnostic,null,2)}\n\`\`\`\n`);}catch{ /* Original test still fails if evidence output is unavailable. */ }
  }
  throw Error(`Windows ACL fixture failed: ${JSON.stringify(diagnostic)}`);
 }
 return result.stdout.trim();
}
for(const engine of ['desktop','core'])test(`Windows ${engine==='desktop'?'PowerShell 5.1':'PowerShell 7'} preserves owner/group and creates private inheritable ACL`,{skip:process.platform!=='win32'},t=>{
 if(engine==='core'&&!process.env.CI){
  const probe=spawnSync('pwsh.exe',['-NoProfile','-NonInteractive','-Command','exit 0'],{windowsHide:true});
  if(probe.error?.code==='ENOENT'){t.skip('Optional PowerShell 7 is absent; Windows CI requires it.');return;}
 }
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-acl-')),directory=path.join(base,"New's 공백"),file=path.join(directory,'registry.json');fs.mkdirSync(directory);
 try{
  const output=execute(`$before=Get-Acl -LiteralPath ${psQuote(directory)}; `+windowsAclScript(directory,{directory:true,create:true})+`
   $after=Get-Acl -LiteralPath ${psQuote(directory)};
   [Console]::Out.Write((ConvertTo-Json -Compress -InputObject @{ownerPreserved=($before.Owner -eq $after.Owner);groupPreserved=($before.Group -eq $after.Group);protected=$after.AreAccessRulesProtected;major=$PSVersionTable.PSVersion.Major}));`,engine);
  const checked=JSON.parse(output);assert.equal(checked.ownerPreserved,true);assert.equal(checked.groupPreserved,true);assert.equal(checked.protected,true);assert.equal(checked.major,engine==='desktop'?5:7);
  writePrivateExclusive(file,{fixture:true});execute(windowsAclScript(file),engine);assertPrivate(file);
  assert.throws(()=>writePrivateExclusive(file,{replaced:true}),{code:'EEXIST'});assert.equal(fs.readFileSync(file,'utf8'),'{"fixture":true}');
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});
test('Windows rejects existing public ACL without changing its descriptor',{skip:process.platform!=='win32'},()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-acl-existing-')),directory=path.join(base,'existing');fs.mkdirSync(directory);
 try{
  execute(`$ErrorActionPreference='Stop'; $p=${psQuote(directory)}; $item=Get-Item -LiteralPath $p; $acl=Get-Acl -LiteralPath $p;
   $sid=[Security.Principal.SecurityIdentifier]::new('S-1-1-0');
   $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::ReadAndExecute,[Security.AccessControl.AccessControlType]::Allow)); $item.SetAccessControl($acl);`);
  const read=()=>execute(`$acl=Get-Acl -LiteralPath ${psQuote(directory)}; [Console]::Out.Write($acl.Sddl);`);
  const before=read();assert.throws(()=>ensurePrivateDirectory(directory),error=>error.diagnostic?.reason==='untrusted-allow');assert.ok(read()===before,'Existing ACL must be preserved');
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});
test('Windows missing-path error exposes safe stage and exit code',{skip:process.platform!=='win32'},()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-acl-error-'));
 try{
  let failure;try{runPowerShell(windowsAclScript(path.join(base,'sensitive-fixture-part'),{directory:true}));}catch(error){failure=error;}
  assert.ok(failure);assert.equal(failure.code,'ORBIT_POWERSHELL_FAILED');assert.equal(failure.diagnostic.stage,'path');assert.equal(failure.diagnostic.exitCode,1);assert.ok(!failure.message.includes(base));assert.ok(!failure.message.includes('sensitive-fixture-part'));
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});
