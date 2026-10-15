import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {root,verifyVendor} from './verify-vendor.mjs';
import {runtimeInfo,stateRoot,claudeSettings} from '../platform/runtime.mjs';
const extensions=process.platform==='win32'?['.exe','.cmd','.bat','']:[''];
const entries=(process.env.PATH??'').split(path.delimiter);
const cli=process.env.ORBIT_CLAUDE_CLI??entries.flatMap(dir=>extensions.map(ext=>path.join(dir,'claude'+ext))).find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
console.log(JSON.stringify({...runtimeInfo(),appleSiliconNative:process.platform==='darwin'&&process.arch==='arm64',node:process.versions.node,nodeCompatible:Number(process.versions.node.split('.')[0])===22,upstream:verifyVendor(),buildPresent:fs.existsSync(path.join(root,'dist/claude-worker.cjs')),claudeCliAvailable:Boolean(cli),cliVersionProbe:'not-executed',cliLauncher:cli?(/\.(cmd|bat)$/i.test(cli)?'batch-requires-reviewed-entry':'native-path'):null,claudeSettingsPresent:fs.existsSync(claudeSettings()),stateDirectory:stateRoot(),settingsDirectory:path.dirname(claudeSettings()),home:os.homedir(),credentialVariablePresence:Object.fromEntries(['ANTHROPIC_API_KEY','CLAUDE_CODE_OAUTH_TOKEN'].map(name=>[name,Boolean(process.env[name])])),authenticationVerified:false,realMacVerified:false,realEnvironmentVerified:false,settingsModified:false},null,2));
