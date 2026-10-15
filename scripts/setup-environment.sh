#!/usr/bin/env bash
# Optional POSIX convenience wrapper. Windows uses npm run bootstrap directly.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run bootstrap
