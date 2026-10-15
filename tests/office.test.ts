import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {PNG} from 'pngjs';
import {roster,reduceAgents,todayCompleted,type OfficeEvent} from '../src/model';
const require=createRequire(import.meta.url);
const {createLayout,loadLayout,layoutKey}:typeof import('../src/layout')=require('../src/layout');
const {OfficeState}:typeof import('../../pixel-agents-p0/webview-ui/src/office/engine/officeState')=require('../../pixel-agents-p0/webview-ui/src/office/engine/officeState');
const {buildDynamicCatalog,getCatalogEntry}:typeof import('../../pixel-agents-p0/webview-ui/src/office/layout/furnitureCatalog')=require('../../pixel-agents-p0/webview-ui/src/office/layout/furnitureCatalog');
const {findPath}:typeof import('../../pixel-agents-p0/webview-ui/src/office/layout/tileMap')=require('../../pixel-agents-p0/webview-ui/src/office/layout/tileMap');
const {setCharacterTemplates}:typeof import('../../pixel-agents-p0/webview-ui/src/office/sprites/spriteData')=require('../../pixel-agents-p0/webview-ui/src/office/sprites/spriteData');
const data=JSON.parse(fs.readFileSync('public/engine-assets.json','utf8'));
buildDynamicCatalog(data.furniture);setCharacterTemplates(data.characters);

test('six distinct original sheets have exact dimensions and animated frames',()=>{
 const sheets=roster.map(a=>fs.readFileSync(`public/characters/char_${a.palette}.png`));
 assert.equal(new Set(sheets.map(s=>s.toString('base64'))).size,6);
 for(const sheet of sheets){const png=PNG.sync.read(sheet);assert.equal(png.width,112);assert.equal(png.height,96);assert.ok(png.data.some(x=>x!==0));}
});
test('every placed asset exists; team, QA, meeting and lounge seats have connected approaches',()=>{
 const layout=createLayout();for(const item of layout.furniture)assert.ok(getCatalogEntry(item.type),item.type);
 const office=new OfficeState(layout);
 for(const uid of ['dev-1','dev-2','analyst','research','ops','other','qa','meeting-1','meeting-2','lounge']){
  const seat=office.seats.get(uid);assert.ok(seat,uid);
  const blocked=new Set(office.blockedTiles);blocked.delete(`${seat.seatCol},${seat.seatRow}`);
  assert.ok(findPath(13,12,seat.seatCol,seat.seatRow,office.tileMap,blocked).length>0,uid+' reachable');
 }
});
test('six concurrent actors use engine movement and completion/removal',()=>{
 const office=new OfficeState(createLayout());
 for(const a of roster){office.addAgent(a.id,a.palette,0,a.seat,true);office.setAgentActive(a.id,true);office.sendToSeat(a.id);}
 assert.equal(office.characters.size,6);
 for(let i=0;i<1200;i++)office.update(.05);
 for(const ch of office.characters.values()){assert.equal(ch.state,'type');assert.equal(ch.isActive,true);}
 office.showPermissionBubble(1);assert.equal(office.characters.get(1)?.bubbleType,'permission');
 office.showWaitingBubble(2);assert.equal(office.characters.get(2)?.bubbleType,'waiting');
 office.removeAgent(6);office.update(1);assert.equal(office.characters.size,5);
});
test('Mock lifecycle is explicit and deduplicates spawn and completion counts',()=>{
 const at=Date.now(),spawn:OfficeEvent={eventId:'a',agentId:1,type:'spawn',at,source:'mock'};
 const agents=reduceAgents([],spawn);assert.equal(reduceAgents(agents,spawn).length,1);
 const done:OfficeEvent={...spawn,eventId:'done',type:'status',status:'completed'};
 assert.equal(reduceAgents(agents,done)[0].status,'completed');assert.equal(todayCompleted([done,done],at),1);
 assert.equal(reduceAgents(agents,{...spawn,type:'remove'}).length,0);
 assert.equal(reduceAgents([], {...spawn,type:'status',status:'coding'}).length,0);
});
test('layout persistence accepts own snapshot and recovers corrupted storage',()=>{
 const values=new Map<string,string>();
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null}});
 const layout=createLayout();layout.furniture[0].col=4;values.set(layoutKey,JSON.stringify(layout));assert.equal(loadLayout().furniture[0].col,4);
 values.set(layoutKey,'broken');assert.deepEqual(loadLayout(),createLayout());
 values.set(layoutKey,JSON.stringify({version:1,cols:40,rows:28,tiles:[],furniture:[]}));assert.deepEqual(loadLayout(),createLayout());
});
