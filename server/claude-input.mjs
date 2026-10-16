export const hookEvents=['SessionStart','SessionEnd','Stop','PermissionRequest','Notification','PreToolUse','PostToolUse','PostToolUseFailure','SubagentStart','SubagentStop','TeammateIdle','TaskCompleted'];
const tools=new Set(['Read','Write','Edit','Bash','Grep','Glob','WebFetch','WebSearch','Agent','Task','AskUserQuestion']);
// Shared by the sender and receiver: never forward prompts, tool input/output,
// transcript paths, cwd, arbitrary names, or environment values.
export function sanitizeClaude(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('invalid event');
 if(typeof raw.session_id!=='string'||!/^[A-Za-z0-9_.:-]{1,160}$/.test(raw.session_id))throw Error('invalid session');
 if(!hookEvents.includes(raw.hook_event_name))throw Error('unsupported event');
 // This stage supports root sessions only. Do not erase explicit child markers
 // from a regular lifecycle/tool event and accidentally turn it into a root.
 if(!['SubagentStart','SubagentStop','TeammateIdle','TaskCompleted'].includes(raw.hook_event_name)&&['agent_id','parent_session_id'].some(key=>raw[key]!==undefined&&raw[key]!==null&&raw[key]!==''))throw Error('child identity not supported');
 const result={session_id:raw.session_id,hook_event_name:raw.hook_event_name};
 if(raw.tool_name!==undefined)result.tool_name=tools.has(raw.tool_name)?raw.tool_name:'Other';
 if(['idle_prompt','permission_prompt'].includes(raw.notification_type))result.notification_type=raw.notification_type;
 if(['startup','resume','clear','compact'].includes(raw.source))result.source=raw.source;
 if(['exit','clear','resume','logout','other'].includes(raw.reason))result.reason=raw.reason;
 if(raw.hook_event_name==='SubagentStart')result.agent_type='subagent';
 return result;
}
