import {useEffect,useState} from 'react';
import {applyChanges,applySnapshot,parseChanges,parseSnapshot,type LiveSnapshot} from './store';
export function useLiveOffice(active:boolean,channel:'claude'|'omp'='claude'){
 const [view,setView]=useState<{snapshot:LiveSnapshot|null;connection:'checking'|'ready'|'offline'|'unprepared';resync:number}>({snapshot:null,connection:'checking',resync:0});
 useEffect(()=>{
  if(!active)return;
  let disposed=false,timer:ReturnType<typeof setTimeout>,current:LiveSnapshot|null=null,lastKnown:LiveSnapshot|null=null,resync=0,recovering=false;
  const controller=new AbortController();
  const read=async(url:string)=>{
   const response=await fetch(url,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(6000)]),cache:'no-store'});
   if(response.status===409){if(channel==='omp'&&lastKnown)throw Error('OMP bridge disconnected');if(!disposed)setView({snapshot:null,connection:'unprepared',resync});return null;}
   if(!response.ok)throw Error('Live unavailable');return response.json() as Promise<unknown>;
  };
  const refresh=async()=>{
   try{
    if(channel==='omp'){
     const raw=await read('/api/omp/snapshot');if(disposed)return;if(raw===null){current=null;recovering=true;return;}
     const next=parseSnapshot(raw);if(next.providerId!=='omp'||next.actors.some(a=>a.providerId!=='omp'))throw Error('Invalid OMP channel');
     if(!current||recovering||current.epoch!==next.epoch)resync++;
     current=applySnapshot(current,next);recovering=false;
     lastKnown=current;setView({snapshot:current,connection:'ready',resync});return;
    }
    if(current){
     const raw=await read(`/api/live/events?after=${encodeURIComponent(current.cursor)}`);if(disposed)return;
     if(raw===null){current=null;return;}
     current=applyChanges(current,parseChanges(raw));
    }
    if(!current){resync++;const raw=await read('/api/live/snapshot');if(disposed)return;if(raw===null)return;current=applySnapshot(lastKnown,parseSnapshot(raw));}
    if(!disposed){lastKnown=current;setView({snapshot:current,connection:'ready',resync});}
   }catch{recovering=true;if(!disposed)setView(previous=>({...previous,connection:'offline'}));}
   finally{if(!disposed)timer=setTimeout(()=>void refresh(),1000);}
  };
  void refresh();
  return()=>{disposed=true;clearTimeout(timer);controller.abort();};
 },[active,channel]);
 return view;
}
