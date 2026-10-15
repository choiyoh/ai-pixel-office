import {TileType,type OfficeLayout} from '../../pixel-agents-p0/webview-ui/src/office/types';
export const zones=[
  {label:'개발팀',caption:'ENGINEERING',col:1,row:1,w:12,h:10,color:'#e0ac73'},
  {label:'분석팀',caption:'ANALYTICS',col:14,row:1,w:11,h:10,color:'#a7a3d9'},
  {label:'연구팀',caption:'RESEARCH',col:26,row:1,w:13,h:10,color:'#84bca4'},
  {label:'운영팀',caption:'OPERATIONS',col:1,row:14,w:12,h:12,color:'#d6a0ba'},
  {label:'회의실',caption:'THE COMMON ROOM',col:14,row:14,w:11,h:12,color:'#c8b27e'},
  {label:'QA · 휴게실',caption:'TEST & RECHARGE',col:26,row:14,w:13,h:12,color:'#8fb6cf'},
];
export function createLayout():OfficeLayout{
 const cols=40,rows=28,tiles:OfficeLayout['tiles']=[],tileColors:NonNullable<OfficeLayout['tileColors']>=[],areaTiles:NonNullable<OfficeLayout['areaTiles']>=[];
 for(let row=0;row<rows;row++) for(let col=0;col<cols;col++){
   const boundary=col===0||row===0||col===cols-1||row===rows-1;
   const zone=zones.find(z=>col>=z.col&&col<z.col+z.w&&row>=z.row&&row<z.row+z.h);
   tiles.push(boundary?TileType.WALL:zone?TileType.FLOOR_2:TileType.FLOOR_1);
   tileColors.push(boundary?null:{h:zone?([30,260,150,330,40,205][zones.indexOf(zone)]):30,s:zone?28:12,b:zone?-12:-22,c:0,colorize:true});
   areaTiles.push(zone?.label??null);
 }
 const furniture:OfficeLayout['furniture']=[];
 const place=(type:string,col:number,row:number,uid=type+'-'+col+'-'+row)=>furniture.push({uid,type,col,row});
 const station=(uid:string,col:number,row:number)=>{place('DESK_FRONT',col,row);place('CUSHIONED_CHAIR_BACK',col,row+2,uid);place('PC_FRONT_OFF',col,row);};
 station('dev-1',3,4);station('dev-2',8,4);station('analyst',17,4);station('research',30,4);
 station('ops',3,18);station('other',8,18);station('qa',29,17);
 place('WOODEN_CHAIR_BACK',18,20,'meeting-1');place('WOODEN_CHAIR_BACK',21,20,'meeting-2');place('DESK_FRONT',18,18);place('DESK_FRONT',21,18);
 place('SOFA_FRONT',34,23,'lounge');place('COFFEE_TABLE',34,21);place('COFFEE',34,21);
 for(const [col,row] of [[1,2],[11,2],[14,2],[23,2],[27,2],[37,2],[1,15],[11,24],[14,24],[24,24],[37,15]])place('PLANT',col,row);
 place('BOOKSHELF',20,2);place('DOUBLE_BOOKSHELF',34,2);place('WHITEBOARD',16,15);
 return {version:1,cols,rows,tiles,tileColors,areaTiles,areas:zones.map(z=>({label:z.label,color:z.color})),furniture};
}
export const layoutKey='orbit.layout.v1';
export const seatsKey='orbit.seats.v1';
export function loadLayout():OfficeLayout{
 try {const value=JSON.parse(localStorage.getItem(layoutKey)??'null') as OfficeLayout|null;
  // This UI persists its supported fixed-size office; reject malformed or incompatible snapshots.
  const valid=value?.version===1&&value.cols===40&&value.rows===28&&Array.isArray(value.tiles)&&value.tiles.length===1120&&value.tiles.every(t=>Number.isInteger(t)&&(t===0||(t>=1&&t<=9)))&&Array.isArray(value.furniture)&&value.furniture.every(f=>typeof f.uid==='string'&&typeof f.type==='string'&&Number.isInteger(f.col)&&Number.isInteger(f.row)&&f.col>=0&&f.col<40&&f.row>=0&&f.row<28);
  return valid?value!:createLayout();
 }catch{return createLayout();}
}
