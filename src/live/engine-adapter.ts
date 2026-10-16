import type {OfficeState} from '../../vendor/pixel-agents/webview-ui/src/office/engine/officeState';
import type {CanvasActor} from '../Canvas';
import {freshness,type LiveActor} from './store';
export const liveSeatKey=(installation:string)=>`orbit.live.seats.v1.${installation}`;
export function syncLiveActor(office:OfficeState,actor:LiveActor,now:number,offline:boolean){
 const id=actor.renderId;
 if(!office.characters.has(id)){
  let seat:string|undefined;
  try{const saved=JSON.parse(localStorage.getItem(liveSeatKey(actor.installationInstanceId))??'{}');if(typeof saved[actor.actorId]==='string')seat=saved[actor.actorId];}catch{ /* ignore malformed view preferences */ }
  office.addAgent(id,actor.palette,0,seat,false);
 }
 const ch=office.characters.get(id)!;
 const fresh=freshness(actor,now,offline)==='fresh';
 const reading=actor.status==='working'&&['Read','Grep','Glob'].includes(actor.lastTool??'');
 const editing=actor.status==='working'&&['Edit','Write'].includes(actor.lastTool??'');
 office.setAgentActive(id,fresh&&(reading||editing));
 office.setAgentTool(id,fresh&&reading?'Read':fresh&&editing?'Write':null);
 ch.bubbleType=null;
 if(fresh&&actor.status==='approval')office.showPermissionBubble(id);
 if(fresh&&actor.status==='waiting-input')office.showWaitingBubble(id,true);
 if(fresh&&(reading||editing))office.sendToSeat(id);
 else{ch.state='idle';ch.path=[];ch.wanderTimer=999;}
}
export function canvasLiveActor(actor:LiveActor,now:number,offline:boolean):CanvasActor{
 return {id:actor.renderId,name:actor.name,status:freshness(actor,now,offline)==='offline'?'disconnected':actor.status==='tool-failed'?'tool-failed':'neutral'};
}
