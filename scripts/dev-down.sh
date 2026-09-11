#!/bin/bash
# Stop the pm2-managed services (api, ai-service, web). The MusicGen launchd
# agent keeps running unless --all is given.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT" || exit 1
export PATH="$HOME/ai/node-v22/bin:$PATH"
"$ROOT/node_modules/.bin/pm2" delete api ai-service web >/dev/null 2>&1; "$ROOT/node_modules/.bin/pm2" save --force >/dev/null 2>&1
echo "stopped api, ai-service, web"
if [ "${1:-}" = "--all" ]; then
  launchctl bootout "gui/$(id -u)/com.qaraamigen.musicgen-api" 2>/dev/null && echo "stopped musicgen-api (launchd agent unloaded; dev-up.sh loads it again)"
fi
