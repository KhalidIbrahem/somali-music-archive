#!/bin/bash
# Health of the local research stack: pm2 processes plus a live check per port.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT" || exit 1
export PATH="$HOME/ai/node-v22/bin:$PATH"
"$ROOT/node_modules/.bin/pm2" ls 2>/dev/null | grep -E 'api|ai-service|web|name' || echo "(pm2 has no processes; run bash scripts/dev-up.sh)"
echo
printf "%-13s %-34s %s\n" "service" "url" "state"
for s in "api|http://127.0.0.1:3001/health" "ai-service|http://127.0.0.1:8000/health" "web|http://127.0.0.1:3000/" "musicgen-api|http://127.0.0.1:8765/health"; do
  n=${s%%|*}; u=${s#*|}; c=$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$u"); [ "$c" = "200" ] && st="up" || st="DOWN ($c)"
  printf "%-13s %-34s %s\n" "$n" "$u" "$st"
done
curl -s -m 3 http://127.0.0.1:8765/health 2>/dev/null | "$HOME/ai/musicgen-env/bin/python" -c "import sys,json;d=json.load(sys.stdin);print();print('musicgen engines:',{k:v['state'] for k,v in d['engines'].items()},'| adapters:',d['adapters_loaded'],'| mps MB:',d['memory'].get('mps_driver_mb'))" 2>/dev/null
echo; echo "logs: $ROOT/logs/"
