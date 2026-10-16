import fs from 'node:fs';
import {runPowerShell,psQuote} from './runtime.mjs';

export function windowsAclScript(file,{directory=false,create=false}={}){
 // Limit access to this user, SYSTEM and local Administrators. New files only
 // are secured; existing user paths are verified, never silently rewritten.
 return `$ErrorActionPreference='Stop'; $stage='path'; $reason='operation'; try {
 $p=${psQuote(file)}; $item=[IO.${directory?'DirectoryInfo':'FileInfo'}]::new($p);
 if(-not $item.Exists){throw [IO.FileNotFoundException]::new('Orbit private path missing')};
 if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){$reason='reparse-point'; throw 'refused'};
 $stage='identity'; $me=[Security.Principal.WindowsIdentity]::GetCurrent().User;
 $allowed=@($me.Value,'S-1-5-18','S-1-5-32-544');
 $sections=[Security.AccessControl.AccessControlSections]'Access, Owner, Group';
 $stage='read-acl'; $acl=[Security.AccessControl.${directory?'DirectorySecurity':'FileSecurity'}]::new($p,$sections);
 $stage='owner'; $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;
 if($allowed -notcontains $owner){$reason='owner-not-allowed'; throw 'refused'};
 `+(create?`
 # Preserve owner/group/audit; only change the DACL on new Orbit paths.
 $stage='protect-dacl'; $acl.SetAccessRuleProtection($true,$false);
 $stage='clear-dacl';
 foreach($rule in @($acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))){$acl.RemoveAccessRuleSpecific($rule)};
 foreach($sid in $allowed){
  $stage='create-sid'; $id=[Security.Principal.SecurityIdentifier]::new($sid);
  $stage='create-rule';
  $rule=[Security.AccessControl.FileSystemAccessRule]::new($id,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]${directory?"'ContainerInherit, ObjectInherit'":"'None'"},[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow);
  $stage='add-rule'; $acl.AddAccessRule($rule);
 };
 $stage='write-acl';
 if($PSVersionTable.PSEdition -eq 'Desktop'){$item.SetAccessControl($acl)}
 else{[IO.FileSystemAclExtensions]::SetAccessControl($item,$acl)};
 $stage='read-acl'; $acl=[Security.AccessControl.${directory?'DirectorySecurity':'FileSecurity'}]::new($p,$sections);
 `:'')+`
 $stage='verify-acl'; $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;
 if($allowed -notcontains $owner){$reason='owner-not-allowed'; throw 'refused'};
 $raw=[Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(),0);
 if($null -eq $raw.DiscretionaryAcl){$reason='missing-dacl'; throw 'refused'};
 foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
  if($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $rule.IdentityReference.Value){$reason='untrusted-allow'; throw 'refused'}
 }
 } catch {
 if($reason -eq 'operation' -and $_.FullyQualifiedErrorId -match 'AutoLoad|Module'){$reason='module-resolution'};
 $failure=$_.Exception; while($null -ne $failure.InnerException){$failure=$failure.InnerException};
 $native='null'; if($failure -is [ComponentModel.Win32Exception]){$native=$failure.NativeErrorCode.ToString([Globalization.CultureInfo]::InvariantCulture)};
 $kind=$failure.GetType().FullName; if($kind -notmatch '^[A-Za-z0-9_.+]+$'){$kind='unclassified'};
 # Fixed enum/type/numeric fields only: no cmdlet autoload or raw messages.
 $detail='{"stage":"'+$stage+'","reason":"'+$reason+'","exception":"'+$kind+'","hresult":'+$failure.HResult.ToString([Globalization.CultureInfo]::InvariantCulture)+',"nativeCode":'+$native+',"psMajor":'+$PSVersionTable.PSVersion.Major.ToString([Globalization.CultureInfo]::InvariantCulture)+',"psMinor":'+$PSVersionTable.PSVersion.Minor.ToString([Globalization.CultureInfo]::InvariantCulture)+',"edition":"'+$PSVersionTable.PSEdition+'"}';
 [Console]::Error.WriteLine('ORBIT_ACL_FAILURE:'+$detail); exit 1
 }`;
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
