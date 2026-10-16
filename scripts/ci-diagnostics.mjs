import {powerShellDiagnostic} from '../platform/runtime.mjs';

export function safeCiFailure(data){
 const name=String(data.name??'');
 const cases=[['synthetic authenticated hooks','synthetic-hooks'],['existing runtime registry','registry-protection'],['PowerShell 5.1','ps51-acl'],['PowerShell 7','ps7-acl'],['existing public ACL','existing-acl'],['missing-path','missing-path']];
 const caseId=cases.find(([match])=>name.includes(match))?.[1]??'integration-other';
 let error=data.details?.error;const visited=new Set();
 while(error?.cause&&!visited.has(error.cause)){visited.add(error);error=error.cause;}
 const scalar=value=>typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value))?value:null;
 let permission=null;
 const match=String(error?.message??'').match(/Windows (?:permission\/launcher operation failed|ACL fixture failed): (\{[^\r\n]*\})/);
 if(match)try{
  const detail=JSON.parse(match[1]);
  permission=powerShellDiagnostic({status:detail.exitCode,signal:detail.signal,error:{code:detail.spawnCode},stderr:'ORBIT_ACL_FAILURE:'+JSON.stringify(detail)});
 }catch{ /* No raw message fallback. */ }
 const output=String(error?.message??'').match(/PowerShell launcher output category=(progress|clixml-other|other)\b/)?.[1]??null;
 return {case:caseId,code:['ERR_ASSERTION','ORBIT_POWERSHELL_FAILED'].includes(error?.code)?error.code:null,actual:scalar(error?.actual),expected:scalar(error?.expected),launcherOutput:output,permission};
}

// Runs in the Node CLI reporter process, outside test-child TAP capture, so
// GitHub recognizes annotations. Never emit raw errors, test paths or payloads.
export default async function* reporter(events){
 for await(const event of events){
  if(event.type==='test:fail')yield `\n::error title=Orbit integration failure::${JSON.stringify(safeCiFailure(event.data))}\n`;
  if(event.type==='test:diagnostic'&&event.data.message?.startsWith('ORBIT_CI_PROBE:'))try{
   const probe=JSON.parse(event.data.message.slice('ORBIT_CI_PROBE:'.length));
   if(probe.kind==='ps-module-environment'){
    const detail=probe.legacy??{};
    const safe={kind:'ps-module-environment',legacyFailed:probe.legacyFailed===true,legacy:powerShellDiagnostic({status:detail.exitCode,stderr:'ORBIT_ACL_FAILURE:'+JSON.stringify(detail)})};
    yield `\n::notice title=Orbit PowerShell module environment::${JSON.stringify(safe)}\n`;
   }
  }catch{ /* Unknown diagnostics are never published. */ }
 }
}
