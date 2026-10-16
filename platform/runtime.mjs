import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

export function runtimeInfo({platform=process.platform,arch=process.arch,env=process.env,release=os.release()}={}){
 const wsl=platform==='linux'&&Boolean(env.WSL_DISTRO_NAME||env.WSL_INTEROP||/microsoft/i.test(release));
 return {platform,arch,wsl,environment:env.ORBIT_ENVIRONMENT??(wsl?'wsl-local':`${platform}-local`),claudeExecution:wsl?'wsl':platform==='win32'?'windows-native':'posix',target:['darwin/x64','darwin/arm64','win32/x64','linux/x64'].includes(`${platform}/${arch}`)?'required':`${arch}`==='arm64'?'investigation':'unlisted'};
}
export function stateRoot({platform=process.platform,home=os.homedir(),env=process.env}={}){
 const p=platform==='win32'?path.win32:path.posix;
 if(env.ORBIT_STATE_DIR){if(!p.isAbsolute(env.ORBIT_STATE_DIR))throw Error('ORBIT_STATE_DIR must be absolute');return p.normalize(env.ORBIT_STATE_DIR);}
 if(platform==='win32')return p.join(env.LOCALAPPDATA??p.join(home,'AppData','Local'),'Orbit Works');
 if(platform==='darwin')return p.join(home,'Library','Application Support','Orbit Works');
 return p.join(env.XDG_STATE_HOME??p.join(home,'.local','state'),'orbit-works');
}
/** @param {{platform?: NodeJS.Platform, home?: string, env?: NodeJS.ProcessEnv, execution?: string}} [options] */
export function claudeSettings({platform=process.platform,home=os.homedir(),env=process.env,execution}={}){
 if(platform==='win32'&&execution==='wsl')throw Error('Run the planner inside the intended WSL distribution with Linux Node; native and WSL homes are separate.');
 if(platform!=='win32'&&execution==='windows-native')throw Error('Run the planner in native Windows with Windows Node.');
 const p=platform==='win32'?path.win32:path.posix;
 const dir=env.CLAUDE_CONFIG_DIR??p.join(home,'.claude');
 if(!p.isAbsolute(dir))throw Error('CLAUDE_CONFIG_DIR must be absolute');
 return p.join(dir,'settings.json');
}
export function npmInvocation(args,{env=process.env,node=process.execPath,platform=process.platform}={}){
 const p=platform==='win32'?path.win32:path;
 const candidates=[env.npm_execpath,env.ORBIT_NPM_CLI,p.join(p.dirname(node),'node_modules/npm/bin/npm-cli.js'),p.join(p.dirname(node),'../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean);
 const cli=candidates.find(candidate=>p.basename(candidate).toLowerCase()==='npm-cli.js'&&fs.existsSync(candidate));
 if(!cli)throw Error('Run this task through npm run, or set ORBIT_NPM_CLI to the installed npm-cli.js. No .cmd shell fallback is used.');
 return {command:node,args:[cli,...args],shell:false};
}
export function runNpm(args,options={}){
 const invocation=npmInvocation(args,{env:options.env??process.env});
 return spawnSync(invocation.command,invocation.args,{...options,shell:false,windowsHide:true});
}
export function powershellExecutable(env=process.env){
 return path.win32.join(env.SystemRoot??env.SYSTEMROOT??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
}
export const psQuote=value=>"'"+value.replaceAll("'","''")+"'";
export function powershellInvocation(script,env=process.env){return {command:powershellExecutable(env),args:['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],shell:false};}
// Do not attach raw child output, command arguments or paths to errors.
export function powerShellDiagnostic(result){
 const stages=new Set(['path','identity','read-acl','owner','protect-dacl','clear-dacl','create-sid','create-rule','add-rule','write-acl','verify-acl']);
 const reasons=new Set(['operation','reparse-point','owner-not-allowed','untrusted-allow','missing-dacl']);
 const types=new Set(['System.UnauthorizedAccessException','System.Security.SecurityException','System.Security.AccessControl.PrivilegeNotHeldException','System.ArgumentException','System.ArgumentNullException','System.InvalidOperationException','System.PlatformNotSupportedException','System.IO.IOException','System.IO.FileNotFoundException','System.IO.DirectoryNotFoundException','System.ComponentModel.Win32Exception','System.Management.Automation.RuntimeException','System.Management.Automation.MethodInvocationException','System.Management.Automation.ItemNotFoundException']);
 let detail;
 for(const line of String(result.stderr??'').split(/\r?\n/)){
  if(!line.startsWith('ORBIT_ACL_FAILURE:'))continue;
  try{const value=JSON.parse(line.slice('ORBIT_ACL_FAILURE:'.length));if(value&&typeof value==='object')detail=value;}catch{ /* Never fall back to raw output. */ }
 }
 const integer=value=>Number.isSafeInteger(value)&&value>=-2147483648&&value<=2147483647?value:null;
 const codes=new Set(['ENOENT','EACCES','EPERM','ETIMEDOUT','ENOBUFS','EINVAL']);
 return {exitCode:integer(result.status),spawnCode:codes.has(result.error?.code)?result.error.code:null,signal:['SIGTERM','SIGKILL','SIGABRT'].includes(result.signal)?result.signal:null,stage:stages.has(detail?.stage)?detail.stage:'engine',reason:reasons.has(detail?.reason)?detail.reason:'operation',exception:types.has(detail?.exception)?detail.exception:'unclassified',hresult:integer(detail?.hresult),nativeCode:integer(detail?.nativeCode),psMajor:integer(detail?.psMajor),psMinor:integer(detail?.psMinor),edition:['Desktop','Core'].includes(detail?.edition)?detail.edition:null};
}
export function runPowerShell(script,{env=process.env,...options}={}){
 const invocation=powershellInvocation(script,env);
 const result=spawnSync(invocation.command,invocation.args,{...options,env,shell:false,windowsHide:true,encoding:'utf8',timeout:15000});
 if(result.error||result.status!==0){
  const diagnostic=powerShellDiagnostic(result);
  throw Object.assign(Error(`Windows permission/launcher operation failed: ${JSON.stringify(diagnostic)}; no fallback to insecure permissions.`),{code:'ORBIT_POWERSHELL_FAILED',diagnostic});
 }
 return result;
}
export async function stopOwnedChild(child,{timeoutMs=2000}={}){
 if(!child||child.exitCode!==null||child.signalCode!==null)return;
 await new Promise((resolve,reject)=>{
  const done=()=>{clearTimeout(timer);clearTimeout(forceTimer);resolve();};
  let forceTimer;const timer=setTimeout(()=>{child.kill('SIGKILL');forceTimer=setTimeout(()=>reject(Error('Owned child did not exit')),1000);},timeoutMs);
  child.once('exit',done);
  if(child.connected)child.send({type:'orbit:shutdown'},error=>{if(error)child.kill('SIGTERM');});else child.kill('SIGTERM');
 });
}
