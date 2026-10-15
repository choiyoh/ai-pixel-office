import {useEffect,useRef} from 'react';
import type {OfficeState} from '../../pixel-agents-p0/webview-ui/src/office/engine/officeState';
import {startGameLoop} from '../../pixel-agents-p0/webview-ui/src/office/engine/gameLoop';
import {renderFrame} from '../../pixel-agents-p0/webview-ui/src/office/engine/renderer';
import type {Agent} from './model';
import {zones} from './layout';

export function OfficeCanvas({office,agents,selected,zoom,onSelect,onMove}:{office:OfficeState;agents:Agent[];selected:number;zoom:number;onSelect:(id:number)=>void;onMove:(seat:string)=>void}){
 const ref=useRef<HTMLCanvasElement>(null);
 const projection=useRef({offsetX:0,offsetY:0,scale:1});
 const state=useRef({agents,selected,zoom});
 useEffect(()=>{state.current={agents,selected,zoom};},[agents,selected,zoom]);
 useEffect(()=>{
  const canvas=ref.current!,container=canvas.parentElement!;
  const resize=()=>{const r=container.getBoundingClientRect();canvas.width=Math.round(r.width*devicePixelRatio);canvas.height=Math.round(r.height*devicePixelRatio);};
  const observer=new ResizeObserver(resize);observer.observe(container);resize();
  // The upstream sprite cache expects integer zoom. Rasterize at 2x, then fit
  // the whole scene with nearest-neighbor scaling to avoid fractional pixel seams.
  const buffer=document.createElement('canvas');buffer.width=1312;buffer.height=928;
  const scene=buffer.getContext('2d')!;
  const stop=startGameLoop(canvas,{update(dt){
   office.update(dt);
   // A disconnected Mock actor is frozen; do not infer an activity state from silence.
   for(const agent of state.current.agents)if(agent.status==='disconnected'){
    const ch=office.characters.get(agent.id);if(ch){ch.isActive=false;ch.path=[];ch.state='idle';ch.wanderTimer=999;}
   }
  },render(ctx){
   const {agents,selected,zoom}=state.current,layout=office.getLayout();
   const fit=Math.min(canvas.width/buffer.width,canvas.height/buffer.height)*zoom;
   const scale=2*fit;
   office.selectedAgentId=selected;
   const visible=new Set(agents.map(a=>a.id));
   const chars=office.getCharacters().filter(c=>visible.has(c.id));
   canvas.dataset.actors=JSON.stringify(chars.map(c=>({id:c.id,x:c.x,y:c.y,state:c.state,frame:c.frame,seat:c.seatId})));
   const sceneOffsets=renderFrame(scene,buffer.width,buffer.height,office.tileMap,office.furniture,chars,2,0,0,{selectedAgentId:selected,hoveredAgentId:null,hoveredTile:null,seats:office.seats,characters:office.characters},undefined,layout.tileColors,40,28);
   const left=(canvas.width-buffer.width*fit)/2,top=(canvas.height-buffer.height*fit)/2;
   ctx.clearRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=false;
   ctx.drawImage(buffer,left,top,buffer.width*fit,buffer.height*fit);
   const offsets={offsetX:left+sceneOffsets.offsetX*fit,offsetY:top+sceneOffsets.offsetY*fit};
   projection.current={...offsets,scale};
   const {offsetX:x,offsetY:y}=offsets;
   ctx.textAlign='left';
   for(const zone of zones){
    ctx.fillStyle='#252a39';ctx.font=`bold ${9*scale}px monospace`;
    ctx.fillText(zone.caption,x+(zone.col*16+8)*scale,y+(zone.row*16+15)*scale);
    ctx.fillStyle=zone.color;ctx.fillRect(x+(zone.col*16+8)*scale,y+(zone.row*16+21)*scale,24*scale,2*scale);
   }
   for(const agent of agents){
    const ch=office.characters.get(agent.id);if(!ch)continue;
    const px=x+ch.x*scale,py=y+(ch.y-31)*scale;
    ctx.textAlign='center';ctx.font=`bold ${8*scale}px monospace`;
    const nameWidth=ctx.measureText(agent.name).width+8*scale;ctx.fillStyle='#1a2232df';ctx.fillRect(px-nameWidth/2,py-23*scale,nameWidth,12*scale);
    ctx.fillStyle='#e5e9ed';ctx.fillText(agent.name,px,py-14*scale);
    ctx.font=`bold ${9*scale}px monospace`;
    if(agent.status==='completed'){
     const phase=performance.now()/280;ctx.fillStyle='#e8a634';
     for(let i=0;i<6;i++){ctx.fillRect(px+Math.cos(phase+i)*18*scale,py+Math.sin(phase+i)*8*scale,2*scale,2*scale);}
     ctx.fillStyle='#205c50';ctx.fillText('✦ DONE',px,py-3*scale);
    }
    if(agent.status==='failed'){ctx.fillStyle='#bb3d48';ctx.fillText('⚠ ERROR',px,py-3*scale);}
    if(agent.status==='disconnected'){
     ctx.fillStyle='#d6dce6bb';ctx.fillRect(px-8*scale,py+5*scale,16*scale,29*scale);
     ctx.fillStyle='#454d64';ctx.fillText('OFFLINE',px,py-3*scale);
    }
    if(agent.status==='idle'){ctx.fillStyle='#746049';ctx.fillText('☕',px,py-3*scale);}
   }
  }});
  return()=>{stop();observer.disconnect();};
 },[office]);
 return <canvas ref={ref} aria-label="이동 가능한 AI 도트 사무실" onClick={e=>{
  const r=e.currentTarget.getBoundingClientRect(),p=projection.current;
  const wx=((e.clientX-r.left)*devicePixelRatio-p.offsetX)/p.scale,wy=((e.clientY-r.top)*devicePixelRatio-p.offsetY)/p.scale;
  const hit=office.getCharacterAt(wx,wy);
  if(hit!==null&&agents.some(a=>a.id===hit)){onSelect(hit);return;}
  const seat=[...office.seats.values()].find(s=>s.seatCol===Math.floor(wx/16)&&s.seatRow===Math.floor(wy/16));
  if(seat&&!seat.assigned)onMove(seat.uid);
 }}/>;
}
