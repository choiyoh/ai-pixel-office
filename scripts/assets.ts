import fs from 'node:fs';
import {verifyVendor} from './verify-vendor.mjs';
import {PNG} from 'pngjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
verifyVendor();
const {buildAssetCache}:typeof import('../vendor/pixel-agents/server/src/assetReload.ts')=require('../vendor/pixel-agents/server/src/assetReload.ts');
const {decodeCharacterPng}:typeof import('../vendor/pixel-agents/core/src/assets/pngDecoder.ts')=require('../vendor/pixel-agents/core/src/assets/pngDecoder.ts');



// Original raster art, authored here from pixel primitives. No downloaded character art.
const palettes=[['#ce7352','#48303d','#ffbd87'],['#557edf','#202f51','#e9b084'],['#9171d9','#402b55','#f5c39c'],['#4baa94','#263e43','#c88e69'],['#ddad56','#59432d','#f3c299'],['#db7ca7','#733d58','#a86d53']];
const characters=palettes.map(([coat,hair,skin],id)=>{
  const png=new PNG({width:112,height:96});
  for(let dir=0;dir<3;dir++) for(let frame=0;frame<7;frame++) {
    const walk=frame<3, bob=walk&&frame===1?1:0, baseX=frame*16, baseY=dir*32;
    const rect=(x:number,y:number,w:number,h:number,color:string)=>{
      const hex=color.slice(1);const rgba=[parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16),255];
      for(let yy=y;yy<y+h;yy++) for(let xx=x;xx<x+w;xx++) if(xx>=0&&xx<16&&yy>=0&&yy<32) {
        const at=((baseY+yy)*112+baseX+xx)*4;rgba.forEach((c,k)=>png.data[at+k]=c);
      }
    };
    const y=bob;
    rect(4,26,3,3,'#252d46');rect(9,26+(walk&&frame===2?1:0),3,3,'#252d46');
    rect(4,17+y,8,9,coat);rect(4,24,8,2,'#374359');rect(6,18+y,2,6,'#f4e7d2');
    rect(2,18+y,2,6,coat);rect(12,18+y,2,6,coat);rect(2,23+y,2,2,skin);rect(12,23+y,2,2,skin);
    rect(3,6+y,10,11,hair);rect(4,9+y,8,8,skin);rect(3,5+y,10,5,hair);
    if(id===0){rect(2,7+y,2,6,hair);rect(5,3+y,2,3,hair);rect(9,4+y,3,3,hair);}
    if(id===1){rect(2,5+y,12,3,'#71b9f0');rect(10,8+y,4,2,'#71b9f0');}
    if(id===2){rect(2,8+y,2,10,hair);rect(12,7+y,2,12,hair);rect(3,6+y,3,2,'#e7b9ff');}
    if(id===3){rect(5,3+y,6,3,hair);rect(4,5+y,8,2,hair);rect(10,7+y,4,2,'#8ae0be');}
    if(id===4){rect(1,7+y,2,8,'#d5dbe9');rect(13,7+y,2,8,'#d5dbe9');rect(2,5+y,12,2,'#d5dbe9');}
    if(id===5){rect(4,3+y,8,4,'#ea9fc4');rect(3,6+y,10,2,'#ea9fc4');rect(12,10+y,2,8,hair);}
    if(dir!==1) {
      const eye=dir===2?10:5;rect(eye,12+y,1,2,'#273147');if(dir===0)rect(10,12+y,1,2,'#273147');
      rect(dir===2?11:7,15+y,2,1,'#ad625e');
      if(id===2){rect(4,11+y,3,3,'#665077');rect(9,11+y,3,3,'#665077');rect(7,12+y,2,1,'#665077');}
    } else rect(4,8+y,8,7,hair);
    if(frame>=3&&frame<5){rect(frame===3?3:4,21,4,2,skin);rect(frame===3?9:10,21,3,2,skin);}
    if(frame>=5){rect(4,21,8,5,'#f5ebd7');rect(8,21,1,5,'#baa994');rect(5,22+(frame%2),2,1,'#7fa4af');}
    if(dir===2){rect(3,18+y,2,6,coat);}
  }
  const buffer=PNG.sync.write(png);fs.writeFileSync(`public/characters/char_${id}.png`,buffer);
  return decodeCharacterPng(buffer);
});
const floors=[0,1].map(pattern=>Array.from({length:16},(_,y)=>Array.from({length:16},(_,x)=>{
 const value=pattern===0?(y===0?143:157+((x*7+y*3)%7)):(y%8===0?166:181+((x*3+y)%5));
 return '#'+value.toString(16).repeat(3);
})));
const assets=await buildAssetCache('vendor/pixel-agents/webview-ui/public',[]);
fs.writeFileSync('public/engine-assets.json',JSON.stringify({characters,floors,walls:assets.wallTiles,furniture:assets.furniture?{catalog:assets.furniture.catalog,sprites:Object.fromEntries(assets.furniture.sprites)}:null}));
console.log('Six original 112×96 character sheets and pinned upstream furniture data generated.');
