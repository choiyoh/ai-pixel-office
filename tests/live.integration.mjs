import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.mjs';
import {openLiveProjection} from '../server/live-projection.mjs';
import {ensurePrivateDirectory,assertPrivate} from '../platform/private-files.mjs';

async function fixture(directory){
 const instance=await createApp({mode:'claude-local',source:'fixture',stateDir:directory});await instance.listen(0);
 const base=`http://127.0.0.1:${instance.app.server.address().port}`;
 const token=JSON.parse(fs.readFileSync(path.join(directory,'runtime/receiver.json'),'utf8')).token;
 const root=await fetch(base),cookie=root.headers.get('set-cookie').split(';')[0];
 return {instance,base,token,read:async url=>{const r=await fetch(base+url,{headers:{cookie}});assert.equal(r.status,200);return r.json();},post:async(id,event,extra={})=>{const r=await fetch(base+'/api/hooks/claude',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({session_id:id,hook_event_name:event,...extra})});assert.equal(r.status,200);return r.json();}};
}

test('authenticated collection produces durable root actors, tool states, tombstones and revision recovery without leaking raw input',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-live-int-')),directory=path.join(temp,'state');
 let f;
 try{
  f=await fixture(directory);let s=await f.read('/api/live/snapshot');assert.equal(s.actors.length,0);
  const initial=s;
  const rawId='SENSITIVE-NATIVE-SESSION';
  const secret='PRIVATE-PROMPT-AND-KEY-DO-NOT-LEAK';
  assert.equal((await fetch(f.base+'/api/live/snapshot')).status,401);
  assert.equal((await fetch(f.base+'/api/hooks/claude',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({session_id:'bad',hook_event_name:'SessionStart'})})).status,401);
  assert.equal((await fetch(f.base+'/api/hooks/claude',{method:'POST',headers:{authorization:`Bearer ${f.token}`,'content-type':'application/json'},body:JSON.stringify({session_id:'../bad',hook_event_name:'SessionStart'})})).status,422);
  assert.equal((await fetch(f.base+'/api/hooks/claude',{method:'POST',headers:{authorization:`Bearer ${f.token}`,'content-type':'application/json'},body:JSON.stringify({session_id:'child',hook_event_name:'SessionStart',agent_id:'child-id'})})).status,422);
  await f.post('orphan','PreToolUse',{tool_name:'Write'});await f.post('orphan','SubagentStart');
  assert.equal((await f.read('/api/live/snapshot')).actors.length,0);
  await f.post(rawId,'SessionStart',{prompt:secret,cwd:'/private/'+secret,source:'startup',name:secret});
  s=await f.read('/api/live/snapshot');assert.equal(s.actors.length,1);const actor=s.actors[0];
  await f.post(rawId,'SessionStart');assert.equal((await f.read('/api/live/snapshot')).revision,s.revision);
  await Promise.all(Array.from({length:5},(_,i)=>f.post('parallel-'+i,'SessionStart')));
  s=await f.read('/api/live/snapshot');assert.equal(s.actors.length,6);assert.equal(new Set(s.actors.map(a=>a.renderId)).size,6);
  for(const tool of ['Read','Grep','Glob','Edit','Write','Bash']){
   await f.post(rawId,'PreToolUse',{tool_name:tool,tool_input:{key:secret},tool_response:secret});
   const a=(await f.read('/api/live/snapshot')).actors.find(a=>a.actorId===actor.actorId);assert.equal(a.status,'working');assert.equal(a.lastTool,tool);
  }
  for(const [event,extra,status] of [['PermissionRequest',{},'approval'],['Notification',{notification_type:'idle_prompt'},'waiting-input'],['PostToolUseFailure',{},'tool-failed'],['Stop',{},'turn-ended']]){
   await f.post(rawId,event,extra);s=await f.read('/api/live/snapshot');assert.equal(s.actors.length,6);assert.equal(s.actors.find(a=>a.actorId===actor.actorId).status,status);
  }
  await f.post(rawId,'SubagentStart');await f.post(rawId,'SubagentStop');assert.equal((await f.read('/api/live/snapshot')).actors.length,6);
  const delta=await f.read('/api/live/events?after='+encodeURIComponent(initial.cursor));assert.equal(delta.resetRequired,false);assert.equal(delta.deltas[0].revision,1);assert.equal(delta.deltas.at(-1).revision,delta.revision);
  await f.post(rawId,'SessionEnd');s=await f.read('/api/live/snapshot');assert.equal(s.actors.length,5);assert.ok(s.tombstones.some(t=>t.actorId===actor.actorId));
  await f.post(rawId,'PreToolUse',{tool_name:'Write'});await f.post(rawId,'SessionStart');assert.equal((await f.read('/api/live/snapshot')).actors.length,5);
  // End-before-start must not create a phantom on a delayed start either.
  await f.post('late-start','SessionEnd');await f.post('late-start','SessionStart');assert.equal((await f.read('/api/live/snapshot')).actors.length,5);
  const beforeRestart=await f.read('/api/live/snapshot');
  const bytes=fs.readFileSync(path.join(directory,'live/claude-fixture.json'),'utf8');
  for(const value of [JSON.stringify(beforeRestart),JSON.stringify(delta),bytes]){assert.ok(!value.includes(secret));assert.ok(!value.includes(rawId));assert.ok(!value.includes(f.token));}
  assertPrivate(path.join(directory,'live'),{directory:true});assertPrivate(path.join(directory,'live/claude-fixture.json'));
  await f.instance.app.close();f=await fixture(directory);s=await f.read('/api/live/snapshot');
  assert.notEqual(s.epoch,beforeRestart.epoch);assert.equal(s.installationInstanceId,beforeRestart.installationInstanceId);assert.deepEqual(s.actors.map(a=>[a.actorId,a.renderId,a.palette]),beforeRestart.actors.map(a=>[a.actorId,a.renderId,a.palette]));assert.ok(s.actors.every(a=>a.restored));
  assert.equal((await f.read('/api/live/events?after='+encodeURIComponent(beforeRestart.cursor))).resetRequired,true);
  await f.post(rawId,'SessionStart');assert.equal((await f.read('/api/live/snapshot')).actors.length,5);
  await f.post('parallel-0','PreToolUse',{tool_name:'Read'});assert.equal((await f.read('/api/live/snapshot')).actors.filter(a=>!a.restored).length,1);
 }finally{await f?.instance.app.close();fs.rmSync(temp,{recursive:true,force:true});}
});

test('projection namespaces, bounded delta gaps, repeated real tool observations and corrupt/private state rejection',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-ledger-'));
 try{
  const open=name=>{const directory=path.join(root,name);ensurePrivateDirectory(directory);return openLiveProjection({directory,source:'fixture',environment:`${process.platform}/${process.arch}`,deltaLimit:2,maxSessions:2,maxRecords:3});};
  const a=open('a'),b=open('b'),start={sessionId:'same',kind:'sessionStart'};
  a.apply(start);b.apply(start);const initial=a.snapshot();
  assert.notEqual(initial.installationInstanceId,b.snapshot().installationInstanceId);assert.notEqual(initial.actors[0].actorId,b.snapshot().actors[0].actorId);
  for(let i=0;i<3;i++)a.apply({sessionId:'same',kind:'toolStart',tool:'Read'});
  assert.equal(a.snapshot().revision,initial.revision+3);assert.equal(a.changes(initial.cursor).resetRequired,true);
  assert.equal(a.changes('invalid').resetRequired,true);assert.equal(a.changes(a.snapshot().epoch+':999').resetRequired,true);
  a.apply({sessionId:'second',kind:'sessionStart'});assert.throws(()=>a.apply({sessionId:'third',kind:'sessionStart'}));
  const file=path.join(root,'a/claude-fixture.json');fs.writeFileSync(file,'{"invalid":true}');assert.throws(()=>open('a'),/Private live state unavailable/);assert.equal(fs.readFileSync(file,'utf8'),'{"invalid":true}');
  if(process.platform!=='win32'){const dir=path.join(root,'public');fs.mkdirSync(dir,{mode:0o755});fs.chmodSync(dir,0o755);assert.throws(()=>openLiveProjection({directory:dir}),/Unsafe private/);assert.equal(fs.statSync(dir).mode&0o777,0o755);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
