import {OfficeState} from '../../pixel-agents-p0/webview-ui/src/office/engine/officeState';
import {setCharacterTemplates} from '../../pixel-agents-p0/webview-ui/src/office/sprites/spriteData';
import {buildDynamicCatalog} from '../../pixel-agents-p0/webview-ui/src/office/layout/furnitureCatalog';
import {setFloorSprites} from '../../pixel-agents-p0/webview-ui/src/office/floorTiles';
import {setWallSprites} from '../../pixel-agents-p0/webview-ui/src/office/wallTiles';
import {setProviderCapabilities} from '../../pixel-agents-p0/webview-ui/src/office/toolUtils';
import {loadLayout,seatsKey} from './layout';
import type {Agent} from './model';

export async function createOffice(){
 const response=await fetch('/engine-assets.json');if(!response.ok)throw new Error('에셋을 불러오지 못했습니다.');
 const data=await response.json();
 setCharacterTemplates(data.characters);buildDynamicCatalog(data.furniture);setFloorSprites(data.floors);setWallSprites(data.walls);
 setProviderCapabilities({readingTools:['Read','Research'],subagentToolNames:['Task','Agent']});
 return new OfficeState(loadLayout());
}
export function syncAgent(office:OfficeState,agent:Agent,isSpawn=false){
 let saved:Record<string,string>={};try{saved=JSON.parse(localStorage.getItem(seatsKey)??'{}');}catch{ /* recover from malformed local settings */ }
 if(!office.characters.has(agent.id))office.addAgent(agent.id,agent.palette,0,saved[agent.id]??agent.seat,false,agent.project);
 office.dismissBubble(agent.id);
 const active=['coding','analysis','testing'].includes(agent.status);
 office.setAgentActive(agent.id,active);
 office.setAgentTool(agent.id,agent.status==='analysis'?'Read':agent.status==='testing'?'Test':'Write');
 const target=isSpawn&&saved[agent.id]?saved[agent.id]:agent.status==='testing'?'qa':agent.status==='idle'?'lounge':saved[agent.id]??agent.seat;
 const ch=office.characters.get(agent.id)!;
 if(office.seats.has(target)&&ch.seatId!==target&&!office.seats.get(target)!.assigned)office.reassignSeat(agent.id,target);
 if(active)office.sendToSeat(agent.id);
 if(agent.status==='approval')office.showPermissionBubble(agent.id);
 if(agent.status==='completed')office.showWaitingBubble(agent.id);
}
