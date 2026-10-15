import {build} from 'esbuild';
import fs from 'node:fs';
await build({entryPoints:['server/claude-worker.ts'],outfile:'dist/claude-worker.cjs',bundle:true,platform:'node',format:'cjs',target:'node22',logLevel:'warning'});
// Dedicated Orbit sender; this does not install any hooks.
await build({entryPoints:['scripts/claude-forwarder.mjs'],outfile:'dist/claude-forwarder.cjs',bundle:true,platform:'node',format:'cjs',target:'node22',logLevel:'warning'});
fs.copyFileSync('vendor/pixel-agents/LICENSE','dist/PIXEL-AGENTS-LICENSE.txt');
