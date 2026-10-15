import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {hookEvents} from '../server/claude-input.mjs';
import {hookLaunch,isOrbitHookCommand} from '../platform/launch.mjs';
import {stateRoot,claudeSettings,runtimeInfo} from '../platform/runtime.mjs';
export function hookPlan({home=os.homedir(),node=process.execPath,forwarder=fileURLToPath(new URL('../dist/claude-forwarder.cjs',import.meta.url)),platform=process.platform,env=process.env,execution}={}){
 const settings=claudeSettings({home,platform,env,execution});
 const p=platform==='win32'?path.win32:path.posix;
 const existingStat=fs.lstatSync(settings,{throwIfNoEntry:false});
 if(existingStat&&(!existingStat.isFile()||existingStat.isSymbolicLink()))throw Error('Refuse non-regular or symlinked settings');
 const before=fs.existsSync(settings)?fs.readFileSync(settings):null;
 const value=before?JSON.parse(before.toString('utf8')):{};
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Settings must be an object');
 if(value.hooks!==undefined&&(!value.hooks||typeof value.hooks!=='object'||Array.isArray(value.hooks)))throw Error('hooks must be an object');
 const after=structuredClone(value);after.hooks??={};
 const launch=hookLaunch({node,forwarder,platform});
 const command=launch.command;
 const entry={matcher:'',hooks:[{type:'command',command,timeout:5}]};
 const changes=[];
 for(const event of hookEvents){
  const existing=after.hooks[event]??[];
  if(!Array.isArray(existing)||existing.some(x=>!x||typeof x!=='object'||!Array.isArray(x.hooks)))throw Error(`Refuse unfamiliar hooks.${event} shape`);
  const commands=existing.flatMap(x=>x.hooks).filter(x=>x&&x.type==='command').map(x=>x.command);
  if(commands.includes(command))continue;
  if(commands.some(isOrbitHookCommand))throw Error('Existing Orbit sender at a different path or casing requires manual review');
  after.hooks[event]=[...existing,entry];
  changes.push({event,preservedEntries:existing.length,append:entry});
 }
 const sha=data=>createHash('sha256').update(data).digest('hex');
 const proposed=Buffer.from(JSON.stringify(after,null,2)+'\n');
 const diff=['--- ~/.claude/settings.json (existing values redacted)','+++ proposed (not written)',...changes.flatMap(c=>[`@@ hooks.${c.event}; ${c.preservedEntries} existing entries preserved @@`,...JSON.stringify(c.append,null,2).split('\n').map(line=>'+'+line)])].join('\n');
 return {dryRun:true,writesPerformed:0,settings,existed:before!==null,originalSha256:before?sha(before):null,proposedSha256:sha(proposed),originalMode:before&&platform!=='win32'?(fs.statSync(settings).mode&0o777).toString(8):null,permissionModel:platform==='win32'?'windows-acl':'posix-mode',execution:execution??runtimeInfo().claudeExecution,hookHost:launch.host,decodedLauncher:launch.script??null,hookInvocationVerified:false,expectedBackup:p.join(stateRoot({home,platform,env}),'backups','settings.<timestamp>.json'),runtimeRegistry:p.join(stateRoot({home,platform,env}),'runtime','receiver.json'),forwarder,changes,diff,requiredApproval:'No apply command is provided. Review on the target OS and obtain explicit approval before any settings write.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args.some(a=>!['--context=windows-native','--context=wsl','--context=posix'].includes(a))||args.length>1){console.error('Read-only command: optional --context=windows-native|wsl|posix; no apply/export.');process.exitCode=2;}
 else try{console.log(JSON.stringify(hookPlan({execution:args[0]?.split('=')[1]}),null,2));}catch{console.error('Dry-run refused: invalid, conflicting, or unreadable settings. No files changed.');process.exitCode=1;}
}
