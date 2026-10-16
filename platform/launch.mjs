import path from 'node:path';
import {powershellInvocation,psQuote} from './runtime.mjs';
const shQuote=value=>"'"+value.replaceAll("'","'\\''")+"'";
export function isOrbitHookCommand(command){
 if(typeof command!=='string')return false;
 const encoded=command.match(/\bpowershell(?:\.exe)?\s+.*?-EncodedCommand\s+([A-Za-z0-9+/=]+)\s*$/i)?.[1];
 const text=encoded?Buffer.from(encoded,'base64').toString('utf16le'):command;
 return text.toLowerCase().includes('claude-forwarder.cjs');
}
export function hookLaunch({node,forwarder,platform=process.platform}){
 const p=platform==='win32'?path.win32:path.posix;
 if(!p.isAbsolute(node)||!p.isAbsolute(forwarder))throw Error('Hook executables must use absolute paths from the same environment');
 if(/[\r\n\0]/.test(node+forwarder))throw Error('Invalid executable path');
 if(platform==='win32'){
  const script=`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=$OutputEncoding=[Text.UTF8Encoding]::new($false); $raw=[Console]::In.ReadToEnd(); $raw | & ${psQuote(node)} ${psQuote(forwarder)}; exit $LASTEXITCODE`;
  const invocation=powershellInvocation(script);
  // ASCII outer command works in native hook hosts without POSIX path quoting.
  return {command:`powershell.exe ${invocation.args.join(' ')}`,host:'windows-powershell',script,invocation};
 }
 return {command:`${shQuote(node)} ${shQuote(forwarder)}`,host:'posix-shell',invocation:{command:node,args:[forwarder],shell:false}};
}
// Future Command Code adapter uses a declared launcher, never a guessed binary
// or event API. .cmd/.bat require a separately reviewed Node entry point.
/** @param {{executable:string,args?:string[],nodeEntry?:string,environment?:string,cwd:string}} options */
export function cliInvocation({executable,args=[],nodeEntry,environment='native',cwd},{platform=process.platform,node=process.execPath}={}){
 const p=platform==='win32'?path.win32:path.posix;
 if(environment==='wsl'&&platform==='win32')throw Error('Launch the adapter inside WSL; native-to-WSL process translation is not implemented');
 if(!p.isAbsolute(executable)||!p.isAbsolute(cwd)||args.some(a=>typeof a!=='string'||a.includes('\0')))throw Error('Explicit absolute executable/cwd and argument array required');
 if(platform==='win32'&&/\.(cmd|bat)$/i.test(executable)){
  if(!nodeEntry||!p.isAbsolute(nodeEntry))throw Error('Batch launcher requires a verified Node entry; no shell:true interpolation');
  return {command:node,args:[nodeEntry,...args],cwd,shell:false};
 }
 return {command:executable,args,cwd,shell:false};
}
