import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {powershellInvocation} from './runtime.mjs';
// Read only PID, parent PID, process birth marker and executable name. Never
// inspect command lines, process environments, prompts or transcript files.
export function inspectProcess(pid,{platform=process.platform,timeoutMs=platform==='win32'?2500:750}={}){
 // The sender keeps its existing deadline; explicit longer budgets are only
 // for native diagnostic probes such as CI, not event handling.
 if(!Number.isSafeInteger(pid)||pid<=1||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)return null;
 try{
  if(platform==='linux'){
   const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8'),end=stat.lastIndexOf(')'),fields=stat.slice(end+2).split(' ');
   return {pid,parent:Number(fields[1]),birth:fields[19],name:fs.readFileSync(`/proc/${pid}/comm`,'utf8').trim()};
  }
  if(platform==='darwin'){
   const r=spawnSync('/bin/ps',['-p',String(pid),'-o','ppid=,lstart=,ucomm='],{encoding:'utf8',timeout:timeoutMs,env:{...process.env,LC_ALL:'C',TZ:'UTC'}});
   const m=r.status===0?r.stdout.trim().match(/^(\d+)\s+(.{24})\s+(.+)$/):null;
   return m?{pid,parent:Number(m[1]),birth:m[2],name:path.basename(m[3])}:null;
  }
  if(platform==='win32')return queryWindows(pid,false,timeoutMs)[0]??null;
 }catch{/* Unsupported or ambiguous ancestry fails closed. */}
 return null;
}
// One PowerShell startup for a bounded ancestry walk, rather than one cold
// process per shell. CIM startup on Windows runners can exceed 1.2 seconds.
function queryWindows(pid,ancestors=false,timeoutMs=2500){
 const script=`$idToRead=${pid}; $items=@(); for($depth=0;$depth -lt ${ancestors?5:1} -and $idToRead -gt 1;$depth++){ $p=Get-CimInstance Win32_Process -Filter ("ProcessId = " + $idToRead); if($null -eq $p){break}; $items+=@{pid=[int]$p.ProcessId;parent=[int]$p.ParentProcessId;birth=$p.CreationDate.ToUniversalTime().ToString('o');name=$p.Name}; $idToRead=[int]$p.ParentProcessId }; [Console]::Write((ConvertTo-Json -InputObject @($items) -Compress))`;
 const invocation=powershellInvocation(script);const r=spawnSync(invocation.command,invocation.args,{encoding:'utf8',timeout:timeoutMs,windowsHide:true});
 try{const value=r.status===0?JSON.parse(r.stdout):[];return Array.isArray(value)?value:[];}catch{return [];}
}
const clockTicks=()=>{const r=spawnSync('/usr/bin/getconf',['CLK_TCK'],{encoding:'utf8',timeout:500});return r.status===0?Number(r.stdout.trim()):NaN;};
const born=p=>{
 if(process.platform==='linux'){try{const boot=Number(fs.readFileSync('/proc/stat','utf8').match(/^btime (\d+)$/m)?.[1]);return boot*1000+Number(p.birth)*1000/clockTicks();}catch{return NaN;}}
 return Date.parse(process.platform==='darwin'?p.birth+' UTC':p.birth);
};
// Native auto-update installations symlink `claude` to a version-named
// executable (e.g. 2.1.299). Accept only the installed PATH target's basename,
// never arbitrary version-shaped process names. No executable path is sent.
/** @param {{env?: NodeJS.ProcessEnv, resolve?: (file:string)=>string, executable?:string}} [options] */
export function installedClaudeName({env=process.env,resolve=fs.realpathSync,executable=process.platform==='win32'?'claude.exe':'claude'}={}){
 for(const directory of (env.PATH??'').split(path.delimiter).filter(Boolean)){
  try{return path.basename(resolve(path.join(directory,executable)));}catch{ /* Try the next PATH entry without printing paths. */ }
 }
 return null;
}
const claude=p=>p&&(/^claude(?:\.exe)?$/i.test(p.name)||p.name===installedClaudeName())&&typeof p.birth==='string'&&p.birth.length>0&&p.birth.length<=80;
export function findClaudeExecution({parent=process.ppid,inspect=inspectProcess}={}){
 if(process.platform==='win32'&&inspect===inspectProcess){const chain=queryWindows(parent,true);const byId=new Map(chain.map(p=>[p.pid,p]));inspect=pid=>byId.get(pid)??null;}
 for(let depth=0;depth<5&&parent>1;depth++){
  const p=inspect(parent);if(!p)return null;
  if(claude(p))return {version:1,pid:p.pid,birth:p.birth};
  if(!/^(?:ba|z|da)?sh(?:\.exe)?$|^cmd\.exe$|^powershell\.exe$|^pwsh\.exe$/i.test(p.name))return null;
  parent=p.parent;
 }
 return null;
}
export function verifyClaudeExecution(proof,{inspect=inspectProcess}={}){
 if(!proof||proof.version!==1||!Number.isSafeInteger(proof.pid)||proof.pid<=1||typeof proof.birth!=='string'||proof.birth.length>80)return null;
 const p=inspect(proof.pid);
 if(!claude(p)||p.birth!==proof.birth)return null;
 const startedAt=born(p);
 return Number.isFinite(startedAt)?{id:JSON.stringify([process.platform,proof.pid,proof.birth]),startedAt}:null;
}
