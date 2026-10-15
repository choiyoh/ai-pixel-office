import fs from 'node:fs';
import {runPowerShell,psQuote} from './runtime.mjs';

export function windowsAclScript(file,{directory=false,create=false}={}){
 // Limit access to this user, SYSTEM and local Administrators. New files only
 // are secured; existing user paths are verified, never silently rewritten.
 return `$ErrorActionPreference='Stop'; $p=${psQuote(file)}; $item=Get-Item -Force -LiteralPath $p; if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'reparse point'}; $me=[Security.Principal.WindowsIdentity]::GetCurrent().User; $allowed=@($me.Value,'S-1-5-18','S-1-5-32-544'); `+
 (create?`$acl=[Security.AccessControl.${directory?'DirectorySecurity':'FileSecurity'}]::new(); $acl.SetOwner($me); $acl.SetAccessRuleProtection($true,$false); foreach($sid in $allowed){$id=[Security.Principal.SecurityIdentifier]::new($sid); $rule=[Security.AccessControl.FileSystemAccessRule]::new($id,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]${directory?"'ContainerInherit, ObjectInherit'":"'None'"},[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow); $acl.AddAccessRule($rule)}; Set-Acl -LiteralPath $p -AclObject $acl; `:'')+
 `$acl=Get-Acl -LiteralPath $p; $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value; if($allowed -notcontains $owner){throw 'owner'}; foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $rule.IdentityReference.Value){throw 'public ACL'}}`;
}
export function assertPrivate(file,{directory=false}={}){
 const stat=fs.lstatSync(file);
 if(stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile()))throw Error('Refuse unsafe private path');
 if(process.platform==='win32')runPowerShell(windowsAclScript(file,{directory}));
 else if((stat.mode&0o077)!==0||(typeof process.getuid==='function'&&stat.uid!==process.getuid()))throw Error('Unsafe private permissions');
 return stat;
}
export function ensurePrivateDirectory(directory){
 const existed=fs.existsSync(directory);fs.mkdirSync(directory,{recursive:true,mode:0o700});
 if(!existed&&process.platform==='win32')runPowerShell(windowsAclScript(directory,{directory:true,create:true}));
 assertPrivate(directory,{directory:true});
}
export function writePrivateExclusive(file,value){
 fs.writeFileSync(file,JSON.stringify(value),{flag:'wx',mode:0o600});
 // Inheritance from the verified private parent prevents a public token window.
 assertPrivate(file);
}
