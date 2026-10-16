import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openLiveProjection} from '../server/live-projection.mjs';
import {applyChanges,applySnapshot,parseSnapshot,parseChanges,freshness} from '../src/live/store';

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
