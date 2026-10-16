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
 const result=spawnSync(engine==='core'?'pwsh.exe':invocation.command,invocation.args,{env:process.env,shell:false,windowsHide:true,encoding:'utf8',timeout:15000});
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
  if(engine==='desktop'){
   // Read the same test-owned folder with the unmodified inherited environment.
   const probe=`$ErrorActionPreference='Stop'; try{$null=Get-Acl -LiteralPath ${psQuote(directory)}}catch{
    $reason='operation'; if($_.FullyQualifiedErrorId -match 'AutoLoad|Module'){$reason='module-resolution'};
    $e=$_.Exception; while($null -ne $e.InnerException){$e=$e.InnerException};
    [Console]::Error.WriteLine('ORBIT_ACL_FAILURE:'+(ConvertTo-Json -Compress -InputObject @{stage='read-acl';reason=$reason;exception=$e.GetType().FullName;hresult=$e.HResult;psMajor=$PSVersionTable.PSVersion.Major;psMinor=$PSVersionTable.PSVersion.Minor;edition=$PSVersionTable.PSEdition})); exit 1}`;
   const invocation=powershellInvocation(probe);
   const legacy=spawnSync(invocation.command,invocation.args,{env:process.env,shell:false,windowsHide:true,encoding:'utf8',timeout:15000});
   t.diagnostic('ORBIT_CI_PROBE:'+JSON.stringify({kind:'ps-module-environment',legacyFailed:legacy.status!==0,legacy:powerShellDiagnostic(legacy)}));
  }
  const output=execute(`$before=[Security.AccessControl.DirectorySecurity]::new(${psQuote(directory)},[Security.AccessControl.AccessControlSections]'Access, Owner, Group'); `+windowsAclScript(directory,{directory:true,create:true})+`
   $after=[Security.AccessControl.DirectorySecurity]::new(${psQuote(directory)},$sections);
   $ownerPreserved=$before.GetOwner([Security.Principal.SecurityIdentifier]) -eq $after.GetOwner([Security.Principal.SecurityIdentifier]);
   $groupPreserved=$before.GetGroup([Security.Principal.SecurityIdentifier]) -eq $after.GetGroup([Security.Principal.SecurityIdentifier]);
   [Console]::Out.Write([String]::Join('|',[string[]]@($ownerPreserved,$groupPreserved,$after.AreAccessRulesProtected,$PSVersionTable.PSVersion.Major)));`,engine);
  assert.deepEqual(output.split('|'),['True','True','True',engine==='desktop'?'5':'7']);
  writePrivateExclusive(file,{fixture:true});execute(windowsAclScript(file),engine);assertPrivate(file);
  assert.throws(()=>writePrivateExclusive(file,{replaced:true}),{code:'EEXIST'});assert.equal(fs.readFileSync(file,'utf8'),'{"fixture":true}');
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});
test('Windows rejects existing public ACL without changing its descriptor',{skip:process.platform!=='win32'},()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-acl-existing-')),directory=path.join(base,'existing');fs.mkdirSync(directory);
 try{
  execute(`$ErrorActionPreference='Stop'; $p=${psQuote(directory)}; $item=[IO.DirectoryInfo]::new($p); $acl=[Security.AccessControl.DirectorySecurity]::new($p,[Security.AccessControl.AccessControlSections]'Access, Owner, Group');
   $sid=[Security.Principal.SecurityIdentifier]::new('S-1-1-0');
   $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::ReadAndExecute,[Security.AccessControl.AccessControlType]::Allow)); $item.SetAccessControl($acl);`);
  const read=()=>execute(`$sections=[Security.AccessControl.AccessControlSections]'Access, Owner, Group'; $acl=[Security.AccessControl.DirectorySecurity]::new(${psQuote(directory)},$sections); [Console]::Out.Write($acl.GetSecurityDescriptorSddlForm($sections));`);
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
