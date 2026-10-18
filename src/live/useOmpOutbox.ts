import {useEffect,useState} from 'react';
import {parseOmpOutboxStatus,type OmpOutboxStatus} from './store';
export function useOmpOutbox(active:boolean,channel:'claude'|'omp'){
 const [status,setStatus]=useState<OmpOutboxStatus|null>(null);
 useEffect(()=>{
  if(!active||channel!=='omp'){setStatus(null);return;}
  let disposed=false,timer:ReturnType<typeof setTimeout>;
  const controller=new AbortController();
  const refresh=async()=>{
   try{
    const response=await fetch('/api/omp/outbox',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(6000)]),cache:'no-store'});
    if(disposed)return;
    if(!response.ok){setStatus(null);return;}
    setStatus(parseOmpOutboxStatus(await response.json() as unknown));
   }catch{if(!disposed)setStatus(null);}
   finally{if(!disposed)timer=setTimeout(()=>void refresh(),5000);}
  };
  void refresh();
  return()=>{disposed=true;clearTimeout(timer);controller.abort();};
 },[active,channel]);
 return status;
}
