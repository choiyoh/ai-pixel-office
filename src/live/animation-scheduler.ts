import {freshness,type LiveActor,type LiveEvent,type LiveSnapshot} from './store';
export type VisualTool='Read'|'Write';
export const LIVE_ANIMATION_MS=750;
// Cosmetic observations only. Never mutates an actor's authoritative status.
export class LiveAnimationScheduler {
 private scope='';
 private revision=0;
 private paused=false;
 private pending=new Map<string,{generation:number;tool:VisualTool;until:number}>();
 constructor(private duration=LIVE_ANIMATION_MS){}
 clear(){this.pending.clear();}
 suspend(){this.clear();this.paused=true;}
 baseline(snapshot:LiveSnapshot){this.clear();this.scope=`${snapshot.source}:${snapshot.installationInstanceId}:${snapshot.epoch}`;this.revision=snapshot.revision;}
 observe(snapshot:LiveSnapshot,now:number,enabled:boolean){
  const scope=`${snapshot.source}:${snapshot.installationInstanceId}:${snapshot.epoch}`;
  if(scope!==this.scope){this.clear();this.scope=scope;this.revision=snapshot.revision;return;}
  const events=snapshot.timeline.filter(e=>e.revision>this.revision).sort((a,b)=>a.revision-b.revision);
  this.revision=Math.max(this.revision,snapshot.revision);
  if(!enabled){this.suspend();return;}
  if(this.paused){this.paused=false;this.clear();return;}
  const actors=new Map(snapshot.actors.map(a=>[a.actorId,a]));
  for(const [id,p] of this.pending){const a=actors.get(id);if(!a||a.generation!==p.generation||freshness(a,now)!=='fresh')this.pending.delete(id);}
  for(const e of events){
   const a=actors.get(e.actorId);
   if(!a||e.generation!==a.generation||freshness(a,now)!=='fresh'||now-Date.parse(e.at)>2500)continue;
   this.event(e,a,now);
  }
 }
 private event(e:LiveEvent,a:LiveActor,now:number){
  // New tool observations preempt older ones; no unbounded replay queue.
  if(e.kind==='toolStart'){
   const tool=['Read','Grep','Glob'].includes(e.tool??'')?'Read':['Edit','Write'].includes(e.tool??'')?'Write':null;
   if(tool)this.pending.set(a.actorId,{generation:a.generation,tool,until:now+this.duration});else this.pending.delete(a.actorId);
  }else if(e.kind==='sessionStart'||e.kind==='sessionEnd'||e.kind==='permissionRequest'||e.status==='waiting-input'||e.status==='tool-failed')this.pending.delete(a.actorId);
 }
 visual(actor:LiveActor,now:number,enabled:boolean):VisualTool|null{
  const p=this.pending.get(actor.actorId);
  if(!enabled||freshness(actor,now)!=='fresh'||!p||p.generation!==actor.generation||now>=p.until){this.pending.delete(actor.actorId);return null;}
  return p.tool;
 }
}
