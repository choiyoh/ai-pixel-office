#!/usr/bin/env bash
set -euo pipefail
export npm_config_cache=/workspace/.npm-cache
npm install --prefix /workspace/p0-tools --no-audit --no-fund node@22.23.3
export PATH=/workspace/p0-tools/node_modules/.bin:$PATH
cd /workspace/pixel-agents-p0
test "$(git rev-parse HEAD)" = d1e007a9fdf3003c252d2973abe1999ae59aec33
HUSKY=0 npm ci --no-audit --no-fund
npm run compile
git diff --exit-code -- core/src/messages.ts package-lock.json
cd /workspace/ai-pixel-office
npm ci --no-audit --no-fund
npm run build
