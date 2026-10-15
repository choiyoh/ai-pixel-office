import {runNpm} from '../platform/runtime.mjs';
import path from 'node:path';
import {root,verifyVendor} from './verify-vendor.mjs';
if(Number(process.versions.node.split('.')[0])!==22)throw Error('Use Node 22 (see .nvmrc); no global runtime is installed by this script.');
verifyVendor();
const result=runNpm(['ci','--no-audit','--no-fund'],{cwd:path.join(root,'vendor/pixel-agents'),env:{...process.env,HUSKY:'0'},stdio:'inherit'});
if(result.status!==0)process.exit(result.status??1);
verifyVendor();
console.log(`Local setup complete: ${process.platform}/${process.arch}, Node ${process.versions.node}. No user settings or global packages changed.`);
