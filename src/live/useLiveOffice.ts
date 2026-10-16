import {useEffect,useState} from 'react';
import {applyChanges,applySnapshot,parseChanges,parseSnapshot,type LiveSnapshot} from './store';
export function useLiveOffice(active:boolean){
 const [view,setView]=useState<{snapshot:LiveSnapshot|null;connection:'checking'|'ready'|'offline'|'unprepared'}>({snapshot:null,connection:'checking'});
 useEffect(()=>{
  if(!active)return;
  let disposed=false,timer:ReturnType<typeof setTimeout>,current:LiveSnapshot|null=null,lastKnown:LiveSnapshot|null=null;
  const controller=new AbortController();
  const read=async(url:string)=>{
   const response=await fetch(url,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(6000)]),cache:'no-store'});
   if(response.status===409){if(!disposed)setView({snapshot:null,connection:'unprepared'});return null;}
   if(!response.ok)throw Error('Live unavailable');return response.json() as Promise<unknown>;
  };
  const refresh=async()=>{
   try{
    if(current){
     const raw=await read(`/api/live/events?after=${encodeURIComponent(current.cursor)}`);if(disposed)return;
     if(raw===null){current=null;return;}
     current=applyChanges(current,parseChanges(raw));
    }
    if(!current){const raw=await read('/api/live/snapshot');if(disposed)return;if(raw===null)return;current=applySnapshot(lastKnown,parseSnapshot(raw));}
    if(!disposed){lastKnown=current;setView({snapshot:current,connection:'ready'});}
   }catch{if(!disposed)setView(previous=>({...previous,connection:'offline'}));}
   finally{if(!disposed)timer=setTimeout(()=>void refresh(),1000);}
  };
  void refresh();
  return()=>{disposed=true;clearTimeout(timer);controller.abort();};
 },[active]);
 return view;
}
