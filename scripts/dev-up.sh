#!/bin/bash
# Bring up the local research stack, supervised, with health checks:
#   api (3001) · ai-service (8000) · web (3000) under pm2, and the MusicGen
#   service (8765) as its launchd user agent. Re-runnable; idempotent.
#
#   bash scripts/dev-up.sh                      start (or restart) everything
#   bash scripts/dev-up.sh --lan                also reachable from the local network
#                                               (the listening review page on an iPad)
#   bash scripts/dev-up.sh --install-login-agent  also run this at login (survives a reboot)
#   bash scripts/dev-up.sh --remove-login-agent
#   bash scripts/dev-status.sh · bash scripts/dev-down.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
export PATH="$HOME/ai/node-v22/bin:$PATH"
PM2="$ROOT/node_modules/.bin/pm2"
AGENT_LABEL="com.qaraamigen.dev-stack"
AGENT_PLIST="$HOME/Library/LaunchAgents/$AGENT_LABEL.plist"
MUSICGEN_LABEL="com.qaraamigen.musicgen-api"
mkdir -p logs apps/api/.data

LAN=0
TAILSCALE="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
case "${1:-}" in
  --lan)
    LAN=1
    export AI_SERVICE_HOST=0.0.0.0
    # A browser opens the microphone only on a secure origin; over the tailnet
    # `Tailscale serve` gives this machine an https address with a valid
    # certificate. Not run here: it changes what the machine exposes.
    if [ -x "$TAILSCALE" ]; then
      TS_NAME=$("$TAILSCALE" status --json 2>/dev/null | sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -1)
      [ -n "$TS_NAME" ] && export REVIEW_HTTPS_URL="https://$TS_NAME"
    fi ;;
  --install-login-agent)
    cat > "$AGENT_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$AGENT_LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$ROOT/scripts/dev-up.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$ROOT/logs/dev-stack.log</string>
  <key>StandardErrorPath</key><string>$ROOT/logs/dev-stack.log</string>
  <key>EnvironmentVariables</key><dict><key>HOME</key><string>$HOME</string><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
</dict></plist>
PLIST
    launchctl bootout "gui/$(id -u)/$AGENT_LABEL" 2>/dev/null
    launchctl bootstrap "gui/$(id -u)" "$AGENT_PLIST" && echo "login agent installed: $AGENT_PLIST (runs this script at login)"
    exit $? ;;
  --remove-login-agent)
    launchctl bootout "gui/$(id -u)/$AGENT_LABEL" 2>/dev/null; rm -f "$AGENT_PLIST"; echo "login agent removed"; exit 0 ;;
esac

[ -x "$PM2" ] || { echo "pm2 is not installed in node_modules; run: npm install"; exit 1; }
[ -x "$HOME/ai/node-v22/bin/node" ] || { echo "Node 22 missing at ~/ai/node-v22"; exit 1; }
[ -x "$HOME/ai/musicgen-env/bin/python" ] || { echo "Python env missing at ~/ai/musicgen-env"; exit 1; }

# Dev accounts: seed once; the API's memory persistence hydrates from this file.
if [ ! -f apps/api/.data/dev-store.json ]; then
  (cd apps/api && "$ROOT/node_modules/.bin/tsx" src/scripts/seed.ts) > "$ROOT/logs/seed.log" 2>&1 \
    && echo "seeded the dev accounts (credentials printed in logs/seed.log)" \
    || echo "seed failed; see logs/seed.log"
fi

# The MusicGen service is a launchd user agent: make sure it is loaded and up.
if ! curl -fsS -m 3 http://127.0.0.1:8765/health >/dev/null 2>&1; then
  launchctl kickstart "gui/$(id -u)/$MUSICGEN_LABEL" 2>/dev/null \
    || launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$MUSICGEN_LABEL.plist" 2>/dev/null \
    || echo "could not start $MUSICGEN_LABEL through launchd; the generation panel will say so"
fi

"$PM2" start ecosystem.config.cjs --update-env >/dev/null 2>&1 || "$PM2" restart ecosystem.config.cjs --update-env >/dev/null
"$PM2" save >/dev/null 2>&1   # pm2 resurrect brings the same set back

wait_for() {  # name url tries
  local i
  for i in $(seq 1 "${3:-45}"); do
    if curl -fsS -m 3 "$2" >/dev/null 2>&1; then printf "  ok   %-12s %s\n" "$1" "$2"; return 0; fi
    sleep 2
  done
  printf "  DOWN %-12s %s   (see logs/%s.err.log)\n" "$1" "$2" "$1"; return 1
}
echo "waiting for health:"
wait_for api          http://127.0.0.1:3001/health 45
wait_for ai-service   http://127.0.0.1:8000/health 45
wait_for web          http://127.0.0.1:3000/       90
wait_for musicgen-api http://127.0.0.1:8765/health 120
echo
echo "web:  http://localhost:3000        demo: http://127.0.0.1:8000/demo"
if [ "$LAN" = 1 ]; then
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
  echo "listening review on the local network:  http://${LAN_IP:-<this Mac>}:8000/demo/review"
  if [ -n "${REVIEW_HTTPS_URL:-}" ]; then
    echo "to record on the iPad (needs https): run  \"$TAILSCALE\" serve --bg 8000"
    echo "  then open  ${REVIEW_HTTPS_URL}/demo/review  on an iPad signed into the tailnet"
  fi
fi
echo "logs: $ROOT/logs/                 status: bash scripts/dev-status.sh   stop: bash scripts/dev-down.sh"
