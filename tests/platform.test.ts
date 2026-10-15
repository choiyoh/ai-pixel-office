import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fork} from 'node:child_process';
import {runtimeInfo,stateRoot,claudeSettings,npmInvocation,stopOwnedChild} from '../platform/runtime.mjs';
import {hookLaunch,cliInvocation,isOrbitHookCommand} from '../platform/launch.mjs';
import {windowsAclScript} from '../platform/private-files.mjs';

test('simulated OS paths and WSL context remain independent',()=>{
 assert.equal(stateRoot({platform:'win32',home:'C:\\Users\\테스트',env:{LOCALAPPDATA:'C:\\Users\\테스트\\AppData\\Local'}}),'C:\\Users\\테스트\\AppData\\Local\\Orbit Works');
 assert.equal(stateRoot({platform:'darwin',home:'/example/person',env:{}}),'/example/person/Library/Application Support/Orbit Works');
 assert.equal(stateRoot({platform:'linux',home:'/example/person',env:{XDG_STATE_HOME:'/example/state'}}),'/example/state/orbit-works');
 assert.equal(claudeSettings({platform:'win32',home:'C:\\Users\\person',env:{}}),'C:\\Users\\person\\.claude\\settings.json');
 assert.equal(claudeSettings({platform:'linux',home:'/example/wsl-person',env:{}}),'/example/wsl-person/.claude/settings.json');
 assert.throws(()=>claudeSettings({platform:'win32',execution:'wsl'}));
 assert.equal(runtimeInfo({platform:'linux',arch:'x64',env:{WSL_DISTRO_NAME:'Ubuntu'},release:'example'}).claudeExecution,'wsl');
 assert.equal(runtimeInfo({platform:'win32',arch:'x64',env:{},release:'example'}).claudeExecution,'windows-native');
 assert.throws(()=>stateRoot({platform:'win32',home:'C:\\Users\\person',env:{ORBIT_STATE_DIR:'relative'}}));
});
test('simulated Windows launcher is encoded, preserves Unicode/metacharacters, and detects old casing',()=>{
 const node='C:\\Program Files\\nodejs\\node.exe',forwarder="C:\\Users\\O'Brien & 공백\\Orbit\\dist\\claude-forwarder.cjs";
 const plan=hookLaunch({node,forwarder,platform:'win32'});
 assert.equal(plan.host,'windows-powershell');assert.equal(plan.invocation.shell,false);
 const decoded=Buffer.from(plan.invocation.args.at(-1)!,'base64').toString('utf16le');
 assert.ok(decoded.includes("O''Brien & 공백"));assert.ok(decoded.includes(node));assert.ok(!plan.command.includes(forwarder));
 assert.equal(isOrbitHookCommand(plan.command),true);
 assert.equal(isOrbitHookCommand(hookLaunch({node:node.toUpperCase(),forwarder:forwarder.toUpperCase(),platform:'win32'}).command),true);
 assert.equal(isOrbitHookCommand('some-unrelated-command'),false);
 assert.throws(()=>hookLaunch({node:'node.exe',forwarder,platform:'win32'}));
});
test('npm uses Node plus npm-cli.js, never direct .cmd or an interpolated shell',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'orbit npm & space '));const cli=path.join(base,'npm-cli.js');fs.writeFileSync(cli,'');
 try{const result=npmInvocation(['run','test','a&b'],{env:{npm_execpath:cli},platform:'win32',node:'C:\\Program Files\\nodejs\\node.exe'});
  assert.equal(result.command,'C:\\Program Files\\nodejs\\node.exe');assert.deepEqual(result.args,[cli,'run','test','a&b']);assert.equal(result.shell,false);
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});
test('Command Code future invocation rejects unreviewed batch and native-to-WSL assumptions',()=>{
 assert.throws(()=>cliInvocation({executable:'C:\\tools\\command-code.cmd',args:[],cwd:'C:\\repo'},{platform:'win32'}));
 const prepared=cliInvocation({executable:'C:\\tools\\command-code.cmd',nodeEntry:'C:\\tools\\verified-entry.js',args:['a & b'],cwd:'C:\\repo'},{platform:'win32',node:'C:\\node.exe'});
 assert.deepEqual(prepared.args,['C:\\tools\\verified-entry.js','a & b']);assert.equal(prepared.shell,false);
 assert.throws(()=>cliInvocation({executable:'C:\\tool.exe',cwd:'C:\\repo',environment:'wsl'},{platform:'win32'}));
 assert.equal(cliInvocation({executable:'/example/tool',args:['a b'],cwd:'/example/repo'},{platform:'linux'}).command,'/example/tool');
});
test('Windows private-file policy verifies ACL SIDs and only protects newly-created paths',()=>{
 const script=windowsAclScript('C:\\state\\registry.json');assert.ok(script.includes('S-1-5-18'));assert.ok(script.includes('S-1-5-32-544'));assert.ok(script.includes('ReparsePoint'));assert.ok(!script.includes('Set-Acl'));
 assert.ok(windowsAclScript('C:\\new-state',{directory:true,create:true}).includes('Set-Acl'));
});
test('owned process shutdown uses IPC on the actual host OS',async()=>{
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'orbit child ')),'worker.cjs');
 fs.writeFileSync(file,"process.on('message', m=>{if(m.type==='orbit:shutdown')process.disconnect();});process.send('ready');");
 const child=fork(file,[],{stdio:['ignore','ignore','ignore','ipc']});
 try{await new Promise(resolve=>child.once('message',resolve));await stopOwnedChild(child);assert.equal(child.exitCode,0);}
 finally{if(child.exitCode===null)child.kill();fs.rmSync(path.dirname(file),{recursive:true,force:true});}
});
