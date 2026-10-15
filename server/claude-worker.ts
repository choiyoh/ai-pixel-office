import {claudeProvider} from '../vendor/pixel-agents/server/src/providers/hook/claude/claude';
// One provider in one process. Installer, team filesystem queries and Runtime
// globals are never invoked. This is a hook-only normalization boundary.
process.on('message',(message:{type?:string;requestId:number;raw:Record<string,unknown>})=>{
 if(message.type==='orbit:shutdown'){process.disconnect?.();return;}
 try{
  const normalized=claudeProvider.normalizeHookEvent(message.raw);
  process.send?.({requestId:message.requestId,normalized:normalized?{sessionId:normalized.sessionId,kind:normalized.event.kind,awaitingInput:'awaitingInput' in normalized.event&&normalized.event.awaitingInput===true}:null,failure:message.raw.hook_event_name==='PostToolUseFailure'});
 }catch{process.send?.({requestId:message.requestId,error:'normalization-failed'});}
});
