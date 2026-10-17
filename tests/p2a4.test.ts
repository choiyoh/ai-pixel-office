import {createRequire} from 'node:module';
import {syncLiveActor,liveSeatKey} from '../src/live/engine-adapter';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {openLiveProjection} from '../server/live-projection.mjs';
import {parseSnapshot,parseChanges,applyChanges,applySnapshot} from '../src/live/store';
import {LiveAnimationScheduler} from '../src/live/animation-scheduler';
import {findClaudeExecution,verifyClaudeExecution,inspectProcess,installedClaudeName} from '../platform/claude-execution.mjs';
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-p2a4-'));let clock=Date.parse('2026-10-17T00:00:00Z');const options={directory:path.join(root,'state'),source:'fixture',environment:`${process.platform}/${process.arch}`,now:()=>new Date(clock).toISOString()};const ledger=openLiveProjection(options);return {root,ledger,options,now:()=>clock,tick:(n:number)=>{clock+=n;},clean:()=>fs.rmSync(root,{recursive:true,force:true})};}
test('100–300ms actions between polls animate 600/750/900ms without changing ended business state',()=>{
 for(const duration of [600,750,900])for(const elapsed of [100,200,300])for(const tool of ['Read','Edit']){const f=fixture();try{const l=f.ledger;l.apply({sessionId:'one',kind:'sessionStart'});const scheduler=new LiveAnimationScheduler(duration);scheduler.observe(parseSnapshot(l.snapshot()),f.now(),true);l.apply({sessionId:'one',kind:'toolStart',tool});f.tick(elapsed);l.apply({sessionId:'one',kind:'toolEnd'});const s=parseSnapshot(l.snapshot());scheduler.observe(s,f.now(),true);assert.equal(s.actors[0].status,'between-tools');assert.equal(scheduler.visual(s.actors[0],f.now(),true),tool==='Read'?'Read':'Write');assert.equal(scheduler.visual(s.actors[0],f.now()+duration-1,true),tool==='Read'?'Read':'Write');assert.equal(scheduler.visual(s.actors[0],f.now()+duration,true),null);assert.equal(s.actors[0].status,'between-tools');}finally{f.clean();}}
});
test('new tools, termination, offline, hidden tabs and resync preempt visual observations',()=>{
 const f=fixture();try{const l=f.ledger;l.apply({sessionId:'one',kind:'sessionStart'});const q=new LiveAnimationScheduler();q.observe(parseSnapshot(l.snapshot()),f.now(),true);const send=(kind:string,tool?:string)=>{f.tick(100);l.apply({sessionId:'one',kind,tool});const s=parseSnapshot(l.snapshot());q.observe(s,f.now(),true);return s;};let s=send('toolStart','Read');s=send('toolStart','Edit');assert.equal(q.visual(s.actors[0],f.now(),true),'Write');s=send('toolStart','Bash');assert.equal(q.visual(s.actors[0],f.now(),true),null);s=send('toolStart','Read');q.observe(s,f.now(),false);assert.equal(q.visual(s.actors[0],f.now(),false),null);s=send('toolStart','Edit');assert.equal(q.visual(s.actors[0],f.now(),true),null);s=send('toolStart','Read');q.suspend();s=send('toolStart','Edit');assert.equal(q.visual(s.actors[0],f.now(),true),null);s=send('toolStart','Read');q.baseline(s);q.observe(s,f.now(),true);assert.equal(q.visual(s.actors[0],f.now(),true),null);s=send('toolStart','Edit');const old=s.actors[0];s=send('sessionEnd');assert.equal(q.visual(old,f.now(),true),null);
 }finally{f.clean();}
});
test('verified new executions resume logical identity, retain generation tombstones, reject duplicates and old executions',()=>{
 const f=fixture();try{const l=f.ledger;const send=(kind:string,executionId:string,startSource?:string)=>l.apply({sessionId:'native',kind,executionId,startSource,executionStartedAt:f.now()});send('sessionStart','run1','startup');let snapshot=parseSnapshot(l.snapshot());const original=snapshot.actors[0];send('sessionEnd','run1');f.tick(1500);send('sessionStart','run2','resume');let next=parseSnapshot(l.snapshot());assert.equal(next.actors[0].actorId,original.actorId);assert.equal(next.actors[0].renderId,original.renderId);assert.equal(next.actors[0].palette,original.palette);assert.equal(next.actors[0].generation,2);assert.equal(next.tombstones[0].generation,1);snapshot=applyChanges(snapshot,parseChanges(l.changes(snapshot.cursor)))!;assert.equal(snapshot.actors[0].generation,2);const revision=l.snapshot().revision;send('sessionStart','run2','resume');assert.equal(l.snapshot().revision,revision);send('toolStart','run1');send('sessionEnd','run1');assert.equal(l.snapshot().revision,revision);send('sessionStart','run2','compact');assert.equal(l.snapshot().actors[0].generation,2);const compactRevision=l.snapshot().revision;send('sessionStart','run2','clear');send('sessionStart','run2','fork');assert.equal(l.snapshot().revision,compactRevision);send('sessionEnd','run2');f.tick(1500);send('sessionStart','run3','resume');next=parseSnapshot(l.snapshot());assert.equal(next.actors[0].generation,3);assert.equal(next.actors[0].actorId,original.actorId);const restarted=openLiveProjection(f.options);assert.equal(restarted.snapshot().actors[0].generation,3);assert.equal(restarted.snapshot().actors[0].restored,true);restarted.apply({sessionId:'native',kind:'toolStart',executionId:'run2',tool:'Edit'});assert.equal(restarted.snapshot().actors[0].status,'observed');restarted.apply({sessionId:'native',kind:'toolStart',executionId:'run3',tool:'Read'});assert.equal(restarted.snapshot().actors[0].status,'working');assert.equal(restarted.snapshot().actors[0].restored,false);
 // Even newer transport revisions may not resurrect an older generation.
 const end=snapshot.tombstones[0];const bad={...l.changes(next.cursor),revision:next.revision+1,cursor:`${next.epoch}:${next.revision+1}`,deltas:[{revision:next.revision+1,upsert:original,tombstone:null,event:null}]};assert.equal(applyChanges(next,parseChanges(bad))!.actors[0].generation,3);assert.equal(applySnapshot(next,snapshot),next);assert.ok(end);
 const bytes=fs.readFileSync(path.join(f.options.directory,'claude-fixture.json'),'utf8');for(const secret of ['native','run1','run2','run3'])assert.ok(!bytes.includes('"'+secret+'"'));
 }finally{f.clean();}
});
test('ambiguous resume, startup/clear/fork reuse and retired process replay never revive terminals',()=>{
 const f=fixture();try{const l=f.ledger;l.apply({sessionId:'one',kind:'sessionStart',executionId:'a'});l.apply({sessionId:'one',kind:'sessionEnd',executionId:'a'});for(const patch of [{executionId:'a',startSource:'resume'},{executionId:'b',startSource:'startup'},{executionId:'b',startSource:'clear'},{executionId:'b',startSource:'fork'},{executionId:'b',startSource:'compact'},{executionId:'b',startSource:'resume',executionStartedAt:f.now()-1000},{startSource:'resume'}]){l.apply({sessionId:'one',kind:'sessionStart',executionStartedAt:f.now()+1000,...patch});assert.equal(l.snapshot().actors.length,0);}l.apply({sessionId:'clear-id',kind:'sessionStart',executionId:'a',startSource:'clear'});l.apply({sessionId:'fork-id',kind:'sessionStart',executionId:'b',startSource:'fork'});assert.equal(l.snapshot().actors.length,2);
 }finally{f.clean();}
});
test('execution ancestry is bounded, denies non-Claude and rejects dead or changed process proofs',()=>{
 const self=inspectProcess(process.pid,{timeoutMs:15000});assert.ok(self);const table=new Map([[9,{pid:9,parent:8,name:'sh',birth:'a'}],[8,{pid:8,parent:1,name:'claude',birth:self.birth}]]);const inspect=(pid:number)=>table.get(pid)??null;const proof=findClaudeExecution({parent:9,inspect});assert.equal(proof?.pid,8);assert.ok(verifyClaudeExecution(proof,{inspect}));assert.equal(verifyClaudeExecution({...proof,birth:'changed'},{inspect}),null);assert.equal(verifyClaudeExecution(proof,{inspect:()=>null}),null);assert.equal(findClaudeExecution({parent:9,inspect:()=>({pid:9,parent:9,name:'sh',birth:'a'})}),null);assert.equal(findClaudeExecution({parent:9,inspect:()=>({pid:9,parent:1,name:'node',birth:'a'})}),null);assert.equal(self.pid,process.pid);assert.equal(inspectProcess(process.pid,{timeoutMs:0}),null);assert.equal(verifyClaudeExecution({version:1,pid:process.pid,birth:'unknown'}),null);
});

test('v1 migration preserves historical identity/terminal state and rejects failed resume evidence',()=>{
 const f=fixture();try{const l=f.ledger;l.apply({sessionId:'old',kind:'sessionStart'});const actor=l.snapshot().actors[0];l.apply({sessionId:'old',kind:'sessionEnd'});const file=path.join(f.options.directory,'claude-fixture.json');const legacy=JSON.parse(fs.readFileSync(file,'utf8'));legacy.version=1;for(const r of legacy.records){delete r.executionKey;delete r.retiredExecutions;delete r.terminals;}for(const e of legacy.timeline){delete e.generation;delete e.tool;delete e.startSource;delete e.endReason;}fs.writeFileSync(file,JSON.stringify(legacy));const before=fs.readFileSync(file);const migrated=openLiveProjection(f.options);assert.deepEqual(fs.readFileSync(file),before);f.tick(1500);migrated.apply({sessionId:'old',kind:'sessionStart',startSource:'resume',executionId:'fresh',executionStartedAt:f.now()});assert.equal(migrated.snapshot().actors[0].actorId,actor.actorId);assert.equal(migrated.snapshot().actors[0].generation,2);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).version,2);assert.equal(openLiveProjection(f.options).snapshot().actors[0].generation,2);
 }finally{f.clean();}
});

test('missing/reordered deltas resync without replaying historical animations; stale deltas never overwrite generation',()=>{
 const f=fixture();try{const l=f.ledger;l.apply({sessionId:'one',kind:'sessionStart'});const before=parseSnapshot(l.snapshot());const q=new LiveAnimationScheduler();q.observe(before,f.now(),true);l.apply({sessionId:'one',kind:'toolStart',tool:'Read'});l.apply({sessionId:'one',kind:'toolEnd'});const changes=parseChanges(l.changes(before.cursor));assert.equal(applyChanges(before,{...changes,deltas:changes.deltas.slice(1)}),null);assert.equal(applyChanges(before,{...changes,deltas:[...changes.deltas].reverse()}),null);const resync=parseSnapshot(l.snapshot());q.baseline(resync);q.observe(resync,f.now(),true);assert.equal(q.visual(resync.actors[0],f.now(),true),null);assert.deepEqual(applyChanges(resync,changes),resync);const current=parseSnapshot(l.snapshot());l.apply({sessionId:'one',kind:'toolStart',tool:'Edit'});f.tick(3000);const stale=parseSnapshot(l.snapshot());q.observe(stale,f.now(),true);assert.equal(q.visual(stale.actors[0],f.now(),true),null);assert.ok(current.revision<stale.revision);
 }finally{f.clean();}
});


test('original engine preserves default/selected seat across generations and can resume during despawn',()=>{
 const require=createRequire(import.meta.url);
 const {OfficeState}=require('../vendor/pixel-agents/webview-ui/src/office/engine/officeState');
 const {createLayout}=require('../src/layout');
 const {buildDynamicCatalog}=require('../vendor/pixel-agents/webview-ui/src/office/layout/furnitureCatalog');
 const {setCharacterTemplates}=require('../vendor/pixel-agents/webview-ui/src/office/sprites/spriteData');
 const data=JSON.parse(fs.readFileSync('public/engine-assets.json','utf8'));buildDynamicCatalog(data.furniture);setCharacterTemplates(data.characters);
 const values=new Map<string,string>(),descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)}});
 const f=fixture();try{f.ledger.apply({sessionId:'seat',kind:'sessionStart'});const a=parseSnapshot(f.ledger.snapshot()).actors[0],o=new OfficeState(createLayout());syncLiveActor(o,a,f.now(),false);const seat=o.characters.get(a.renderId).seatId;assert.equal(JSON.parse(values.get(liveSeatKey(a.installationInstanceId))!)[a.actorId],seat);o.removeAgent(a.renderId);syncLiveActor(o,{...a,generation:2},f.now(),false);assert.equal(o.characters.size,1);assert.equal(o.characters.get(a.renderId).seatId,seat);assert.notEqual(o.characters.get(a.renderId).matrixEffect,'despawn');o.removeAgent(a.renderId);o.update(1);syncLiveActor(o,{...a,generation:3},f.now(),false);assert.equal(o.characters.get(a.renderId).seatId,seat);
 }finally{f.clean();if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else Reflect.deleteProperty(globalThis,'localStorage');}
});


test('native version basenames come only from the installed PATH target',()=>{
 const expected=process.platform==='win32'?'2.1.299.exe':'2.1.299';
 const result=installedClaudeName({env:{PATH:path.join(os.tmpdir(),'fake-cli')},resolve:()=>path.join(os.tmpdir(),'versions',expected)});
 assert.equal(result,expected);
 assert.equal(installedClaudeName({env:{PATH:''},resolve:()=>{throw Error('missing');}}),null);
 const fake={pid:7,parent:1,birth:'unknown',name:'99.99.999-uninstalled'};
 assert.equal(findClaudeExecution({parent:7,inspect:()=>fake}),null);
});
