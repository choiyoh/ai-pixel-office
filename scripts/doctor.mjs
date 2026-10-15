import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {root,verifyVendor} from './verify-vendor.mjs';
const cli=spawnSync('claude',['--version'],{stdio:'ignore',timeout:5000});
console.log(JSON.stringify({platform:process.platform,arch:process.arch,appleSiliconNative:process.platform==='darwin'&&process.arch==='arm64',node:process.versions.node,nodeCompatible:Number(process.versions.node.split('.')[0])===22,upstream:verifyVendor(),buildPresent:fs.existsSync(path.join(root,'dist/claude-worker.cjs')),claudeCliAvailable:cli.status===0,claudeSettingsPresent:fs.existsSync(path.join(os.homedir(),'.claude/settings.json')),credentialVariablePresence:Object.fromEntries(['ANTHROPIC_API_KEY','CLAUDE_CODE_OAUTH_TOKEN'].map(name=>[name,Boolean(process.env[name])])),authenticationVerified:false,realMacVerified:false,settingsModified:false},null,2));
