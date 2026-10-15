import {root} from './verify-vendor.mjs';
import {runNpm} from '../platform/runtime.mjs';
for(const args of [['ci','--no-audit','--no-fund'],['run','setup'],['run','build']]){
 const result=runNpm(args,{cwd:root,stdio:'inherit'});
 if(result.status!==0){process.exitCode=result.status??1;break;}
}
