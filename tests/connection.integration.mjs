import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createApp} from '../server/app.mjs';
import {hookPlan} from '../scripts/hooks-plan.mjs';
import {hookLaunch} from '../platform/launch.mjs';
import {assertPrivate,ensurePrivateDirectory} from '../platform/private-files.mjs';
import {sanitizeClaude} from '../server/claude-input.mjs';

function integrationEvidence(stage,error){
 if(!process.env.CI||!process.env.GITHUB_STEP_SUMMARY)return;
 const scalar=value=>typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value))?value:null;
 const evidence={stage,result:error?'failed':'passed',code:['ERR_ASSERTION','ORBIT_POWERSHELL_FAILED','EEXIST'].includes(error?.code)?error.code:null,actual:scalar(error?.actual),expected:scalar(error?.expected),permission:error?.code==='ORBIT_POWERSHELL_FAILED'?error.diagnostic:null};
 try{fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\n### Integration checkpoint\n\n\`\`\`json\n${JSON.stringify(evidence,null,2)}\n\`\`\`\n`);}catch{ /* Never hide the test outcome if summary output fails. */ }
}

test('Hook dry-run preserves unknown user settings, redacts secrets, quotes spaces and writes nothing',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-plan-'));
 try{
  fs.mkdirSync(path.join(home,'.claude'));const file=path.join(home,'.claude/settings.json');
  const content=JSON.stringify({env:{SECRET:'DO-NOT-LEAK'},permissions:{allow:['Read']},hooks:{PreToolUse:[{matcher:'Bash',hooks:[{type:'command',command:'my-existing-hook --secret DO-NOT-LEAK'}]}]}});
  fs.writeFileSync(file,content,{mode:0o640});
  if(process.platform!=='win32')fs.chmodSync(file,0o640); // Explicit fixture mode, independent of the host umask.
  const before=fs.readdirSync(path.join(home,'.claude'));
  const node=process.execPath,forwarder=path.join(home,"Repo's Space",'dist','claude-forwarder.cjs');
  const plan=hookPlan({home,node,forwarder,env:{}});
  const originalMode=fs.statSync(file).mode&0o777;
  assert.equal(plan.writesPerformed,0);assert.equal(plan.changes.length,12);assert.equal(plan.changes.find(c=>c.event==='PreToolUse').preservedEntries,1);
  if(process.platform!=='win32'){
   const quoted=spawnSync('/bin/sh',['-c',`set -- ${plan.changes[0].append.hooks[0].command}; printf '%s\n' "$@"`],{encoding:'utf8'});
   assert.equal(quoted.status,0);assert.deepEqual(quoted.stdout.trim().split('\n'),[node,forwarder]);
  }else assert.equal(plan.hookHost,'windows-powershell');
  assert.ok(!JSON.stringify(plan).includes('DO-NOT-LEAK'));
  assert.equal(fs.readFileSync(file,'utf8'),content);assert.deepEqual(fs.readdirSync(path.join(home,'.claude')),before);assert.equal(fs.statSync(file).mode&0o777,originalMode);
  const entry=plan.changes[0].append;
  fs.writeFileSync(file,JSON.stringify({hooks:{SessionStart:[entry]}}));assert.equal(hookPlan({home,node,forwarder,env:{}}).changes.length,11);
  fs.writeFileSync(file,'{"hooks":[]}');assert.throws(()=>hookPlan({home,env:{}}));assert.equal(fs.readFileSync(file,'utf8'),'{"hooks":[]}');
  if(process.platform!=='win32'){fs.unlinkSync(file);fs.symlinkSync(path.join(home,'missing-target'),file);assert.throws(()=>hookPlan({home,env:{}}));assert.ok(fs.lstatSync(file).isSymbolicLink());}
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('sanitizer excludes prompts, paths, arbitrary tool inputs, names and output',()=>{
 const safe=sanitizeClaude({session_id:'session-1',hook_event_name:'PreToolUse',tool_name:'Read',tool_input:{file_path:'/secret/password',api_key:'DO-NOT-LEAK'},prompt:'DO-NOT-LEAK',cwd:'/private/project',transcript_path:'/private/session',tool_response:'DO-NOT-LEAK'});
 assert.deepEqual(safe,{session_id:'session-1',hook_event_name:'PreToolUse',tool_name:'Read'});
 assert.throws(()=>sanitizeClaude({session_id:'../../bad',hook_event_name:'Stop'}));
 assert.throws(()=>sanitizeClaude({session_id:'a',hook_event_name:'UserPromptSubmit'}));
});

test('default Mock rejects hook writes and unauthenticated UI data, DNS rebinding and foreign origins',async()=>{
 const {app}=await createApp();
 try{
  const headers={host:'127.0.0.1:4173'};
  assert.equal((await app.inject({url:'/api/health',headers})).json().realMacVerified,false);
  assert.equal((await app.inject({url:'/api/events',headers})).statusCode,401);
  assert.notEqual((await app.inject({url:'/api/%65vents',headers})).statusCode,200);
  assert.equal((await app.inject({url:'/api/health',headers:{host:'attacker.example'}})).statusCode,403);
  assert.equal((await app.inject({url:'/api/health',headers:{...headers,origin:'https://attacker.example'}})).statusCode,403);
  assert.equal((await app.inject({url:'/api/hooks/claude',method:'POST',headers,payload:{}})).statusCode,409);
 }finally{await app.close();}
});

test('synthetic authenticated hooks pass through isolated original Claude Provider and never become verified Mac evidence',async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-intake-')),directory=path.join(base,'state');
 const instance=await createApp({mode:'claude-local',source:'fixture',stateDir:directory});
 let stage='receiver-start';
 try{
  await instance.listen(0);const port=instance.app.server.address().port;
  stage='registry-read';
  const registryFile=path.join(directory,'runtime/receiver.json'),registry=JSON.parse(fs.readFileSync(registryFile,'utf8'));
  assertPrivate(registryFile);
  const url=`http://127.0.0.1:${port}`;
  const root=await fetch(url);const cookie=root.headers.get('set-cookie').split(';')[0];
  const headers={'content-type':'application/json',authorization:`Bearer ${registry.token}`};
  const post=(provider,event)=>fetch(`${url}/api/hooks/${provider}`,{method:'POST',headers,body:JSON.stringify(event)});
  const event={session_id:'same-session',hook_event_name:'SessionStart'};
  stage='auth-and-provider-validation';
  assert.equal((await fetch(`${url}/api/hooks/claude`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(event)})).status,401);
  assert.equal((await post('deepseek',event)).status,404);
  stage='original-provider-normalization';assert.equal((await post('claude',event)).status,200);
  for(let i=1;i<=6;i++)assert.equal((await post('claude',{session_id:`session-${i}`,hook_event_name:'PreToolUse',tool_name:'Read',tool_input:{api_key:'DO-NOT-LEAK'}})).status,200);
  await post('claude',{...event,hook_event_name:'Stop'});
  stage='snapshot-projection';let snapshot=await (await fetch(`${url}/api/events`,{headers:{cookie}})).json();
  assert.equal(snapshot.source,'fixture');assert.equal(snapshot.validation,'unverified-on-real-environment');assert.equal(snapshot.sessions.length,7);
  assert.equal(snapshot.sessions.filter(s=>s.status==='working').length,6);assert.ok(snapshot.sessions.some(s=>s.status==='turn-ended'));
  assert.ok(!JSON.stringify(snapshot).includes('DO-NOT-LEAK'));assert.ok(!JSON.stringify(snapshot).includes('same-session'));
  // Test the actual packaged sender, with a fixture registry and synthetic stdin.
  const launcherDir=path.join(base,"Actor's 공백");fs.mkdirSync(launcherDir);
  const forwarder=path.join(launcherDir,'claude-forwarder.cjs');fs.copyFileSync('dist/claude-forwarder.cjs',forwarder);
  const launch=hookLaunch({node:process.execPath,forwarder});
  const invoke=process.platform==='win32'?launch.invocation:{command:'/bin/sh',args:['-c',launch.command]};
  const child=spawn(invoke.command,invoke.args,{env:{...process.env,ORBIT_STATE_DIR:directory},shell:false,stdio:['pipe','pipe','pipe']});
  stage='hook-launch-exit';
  child.stdin.end(JSON.stringify({...event,hook_event_name:'PermissionRequest',prompt:'DO-NOT-LEAK'}));
  const output=[];child.stdout.on('data',x=>output.push(x));child.stderr.on('data',x=>output.push(x));
  assert.equal(await new Promise(resolve=>child.on('exit',resolve)),0);stage='hook-launch-output';
  const bytes=Buffer.concat(output),text=bytes.toString('utf8');
  const category=/S=["']progress["']/i.test(text)?'progress':text.includes('CLIXML')?'clixml-other':'other';
  assert.equal(bytes.length,0,'PowerShell launcher output category='+category);
  stage='hook-approval-event';snapshot=await (await fetch(`${url}/api/events`,{headers:{cookie}})).json();assert.ok(snapshot.sessions.some(s=>s.status==='approval'));
  stage='connection-and-body-limit';
  assert.equal((await (await fetch(`${url}/api/connection`,{headers:{cookie}})).json()).realMacVerified,false);
  assert.equal((await fetch(`${url}/api/hooks/claude`,{method:'POST',headers,body:' '.repeat(66000)})).status,413);
  integrationEvidence('synthetic-hooks-complete');
 }catch(error){integrationEvidence(stage,error);throw error;}
 finally{await instance.app.close();assert.ok(!fs.existsSync(path.join(directory,'runtime/receiver.json')));fs.rmSync(base,{recursive:true,force:true});}
});

test('existing runtime registry is not overwritten and invalid mode is refused',async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-registry-')),directory=path.join(base,'state');ensurePrivateDirectory(directory);ensurePrivateDirectory(path.join(directory,'runtime'));
 const file=path.join(directory,'runtime/receiver.json');fs.writeFileSync(file,'user-owned-existing-file',{mode:0o600});
 const instance=await createApp({mode:'claude-local',source:'fixture',stateDir:directory});
 try{await assert.rejects(()=>instance.listen(0));assert.equal(fs.readFileSync(file,'utf8'),'user-owned-existing-file');await assert.rejects(()=>createApp({mode:'public'}));integrationEvidence('existing-registry-preserved');}
 catch(error){integrationEvidence('existing-registry-protection',error);throw error;}
 finally{await instance.app.close();fs.rmSync(base,{recursive:true,force:true});}
});
