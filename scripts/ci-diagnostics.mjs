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
 return {case:caseId,code:['ERR_ASSERTION','ORBIT_POWERSHELL_FAILED'].includes(error?.code)?error.code:null,actual:scalar(error?.actual),expected:scalar(error?.expected),permission};
}

// Runs in the Node CLI reporter process, outside test-child TAP capture, so
// GitHub recognizes annotations. Never emit raw errors, test paths or payloads.
export default async function* reporter(events){
 for await(const event of events)if(event.type==='test:fail')yield `\n::error title=Orbit integration failure::${JSON.stringify(safeCiFailure(event.data))}\n`;
}
