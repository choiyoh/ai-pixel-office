import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openLiveProjection} from '../server/live-projection.mjs';
import {applyChanges,applySnapshot,parseSnapshot,parseChanges,freshness,parseSceneSnapshot,parseSceneNotices} from '../src/live/store';

test('Live store rejects gaps, reordered deltas, epoch/source drift and stale snapshots; duplicates are idempotent',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-reducer-')),directory=path.join(base,'state');
 try{
  const ledger=openLiveProjection({directory,source:'fixture',environment:`${process.platform}/${process.arch}`});
  const initial=parseSnapshot(ledger.snapshot());
  ledger.apply({sessionId:'one',kind:'sessionStart'});ledger.apply({sessionId:'two',kind:'sessionStart'});
  const changes=parseChanges(ledger.changes(initial.cursor));
  const current=applyChanges(initial,changes)!;assert.equal(current.actors.length,2);
  assert.deepEqual(applyChanges(current,changes),current);assert.equal(applySnapshot(current,initial),current);
  assert.equal(applyChanges(initial,{...changes,deltas:changes.deltas.slice(1)}),null);
  assert.equal(applyChanges(initial,{...changes,deltas:[...changes.deltas].reverse()}),null);
  assert.equal(applyChanges(current,{...changes,epoch:'another-epoch'}),null);
  assert.equal(applyChanges(current,{...changes,source:'live'}),null);
  assert.equal(applyChanges(current,{...changes,resetRequired:true}),null);
  ledger.apply({sessionId:'one',kind:'sessionEnd'});
  const ended=applyChanges(current,parseChanges(ledger.changes(current.cursor)))!;assert.equal(ended.actors.length,1);
  assert.equal(applySnapshot(ended,current),ended);
  // Even a syntactically contiguous late upsert cannot revive a tombstone.
  const old=current.actors[0];
  const late={...changes,revision:ended.revision+1,cursor:`${ended.epoch}:${ended.revision+1}`,deltas:[{revision:ended.revision+1,upsert:old,tombstone:null,event:null}]};
  assert.equal(applyChanges(ended,late)!.actors.length,1);
  const restored={...ended.actors[0],restored:true};
  assert.equal(freshness(restored,Date.parse(restored.lastEventAt)),'stale');
  assert.equal(freshness(old,Date.parse(old.lastEventAt)+30001),'stale');
  assert.equal(freshness(old,Date.parse(old.lastEventAt)+120001),'offline');
  assert.equal(freshness(old,Date.parse(old.lastEventAt),true),'offline');
  assert.equal(ended.actors.length,1); // offline is not SessionEnd
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});

test('Live protocol refuses unsafe labels, mixed sources, duplicate render IDs and arbitrary tools',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-protocol-')),directory=path.join(base,'state');
 try{
  const ledger=openLiveProjection({directory,source:'fixture',environment:`${process.platform}/${process.arch}`});ledger.apply({sessionId:'one',kind:'sessionStart'});
  const s=parseSnapshot(ledger.snapshot()),a=s.actors[0];
  for(const patch of [{name:'PRIVATE-PROMPT'},{environment:'/private/home'},{source:'live'},{lastTool:'private-tool'}])assert.throws(()=>parseSnapshot({...s,actors:[{...a,...patch}]}));
  assert.throws(()=>parseSnapshot({...s,actors:[a,a]}));
  assert.throws(()=>parseChanges({...ledger.changes(s.cursor),cursor:'broken'}));
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});

test('Scene snapshots keep channel names, namespace engine keys and refuse raw proofs',()=>{
 const install='3c1f6a2e-1a5e-4a60-9d2c-6a1a4b7c1111';
 const actor=(over:Record<string,unknown>)=>({actorId:'11111111-2222-4333-8444-555555555555',sceneId:1,renderId:1,providerId:'claude',providerRenderId:1,installationInstanceId:install,source:'fixture',environment:'darwin/arm64',name:'Claude · 001',palette:0,generation:1,status:'working',kind:'toolStart',lastTool:'Read',observedAt:'2026-10-18T00:00:00Z',lastEventAt:'2026-10-18T00:00:00Z',restored:false,delegatedBy:null,...over});
 const snapshot=(over:Record<string,unknown>={})=>({ready:true,epoch:'a|b',revision:'c7.o3',cursor:'a|b:c7.o3',source:'fixture',environment:'darwin/arm64',installationInstanceId:install,providers:{claude:{ready:true,epoch:'a',revision:7},omp:{ready:true,epoch:'b',revision:3}},actors:[actor({})],timeline:[],notices:[],lastEventAt:'2026-10-18T00:00:00Z',receivedAt:'2026-10-18T00:00:00Z',...over});
 const parsed=parseSceneSnapshot(snapshot());
 assert.equal(parsed.revision,7000003);assert.equal(parsed.cursor,'a|b:c7.o3');assert.equal(parsed.actors.length,1);
 // The OMP channel keeps its display name while its engine key is namespaced.
 const omp=parseSceneSnapshot(snapshot({actors:[actor({actorId:'99999999-2222-4333-8444-555555555555',sceneId:1000001,renderId:1000001,providerId:'omp',providerRenderId:1,name:'OMP · 001',palette:2,quality:'contiguous',modelFamily:'deepseek',modelProvider:'commandcode'})]}));
 assert.equal(omp.actors[0]!.name,'OMP · 001');assert.equal(omp.actors[0]!.renderId,1000001);
 // Scene validation takes only the resolved label; a raw proof is refused.
 assert.throws(()=>parseSceneSnapshot(snapshot({actors:[actor({delegatedBy:{name:'Claude · 001',pid:42}})]})));
 assert.equal(parseSceneSnapshot(snapshot({actors:[actor({delegatedBy:{name:'Claude · 001',sceneId:1}})]})).actors[0]!.delegatedBy!.sceneId,1);
 assert.throws(()=>parseSceneSnapshot(snapshot({actors:[actor({name:'PRIVATE'})]})));
 assert.throws(()=>parseSceneSnapshot(snapshot({actors:[actor({}),actor({})]})));
 assert.throws(()=>parseSceneSnapshot(snapshot({ready:false})));
 assert.throws(()=>parseSceneSnapshot(snapshot({revision:'7'})));
 assert.deepEqual(parseSceneNotices({notices:[{providerId:'omp',reason:'omp-unavailable'},{providerId:'x',reason:'y'},{providerId:'claude',reason:'/private'}]}),[{providerId:'omp',reason:'omp-unavailable'}]);
});
