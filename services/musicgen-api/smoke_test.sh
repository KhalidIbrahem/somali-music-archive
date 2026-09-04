#!/bin/bash
# Smoke test for the running QaraamiGen API. Uses the token from the env file outside the repo.
# Usage: ./smoke_test.sh [host]   (default 127.0.0.1)
set -u
HOST=${1:-127.0.0.1}; PORT=${MUSICGEN_API_PORT:-8765}; BASE="http://$HOST:$PORT"
TOKEN=$(grep '^MUSICGEN_API_TOKEN=' ~/ai/musicgen-api/musicgen-api.env | cut -d= -f2)
AUTH="Authorization: Bearer $TOKEN"
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS $1 ($2)"; pass=$((pass+1)); else echo "FAIL $1 (got $2, want $3)"; fail=$((fail+1)); fi; }

check "health 200"            "$(curl -s -o /dev/null -w '%{http_code}' $BASE/health)" 200
check "adapters needs token"  "$(curl -s -o /dev/null -w '%{http_code}' $BASE/adapters)" 401
check "adapters wrong token"  "$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer nope' $BASE/adapters)" 401
check "adapters 200"          "$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" $BASE/adapters)" 200
check "generate rejects 31s"  "$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" -H 'content-type: application/json' -d '{"prompt":"x oud","duration":31}' $BASE/generate)" 422
check "generate bad adapter"  "$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" -H 'content-type: application/json' -d '{"prompt":"a slow oud piece","adapter":"flash"}' $BASE/generate)" 422

body='{"prompt":"Somali qaraami led by the oud (kaban), moderate at 100 BPM, pentatonic melody rooted on A, intimate home recording","duration":5,"seed":7,"score":true}'
for a in base oud harvard_raw; do
  out=$(curl -s -H "$AUTH" -H 'content-type: application/json' -d "${body%\}},\"adapter\":\"$a\"}" $BASE/generate)
  id=$(echo "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("id",""))' 2>/dev/null)
  prov=$(echo "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("yes" if "not distributed" in d.get("provenance","") else "no")' 2>/dev/null)
  pcs=$(echo "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); p=d.get("pcs",{}); print(p.get("pcs","unscored"), p.get("voiced_fraction",""))' 2>/dev/null)
  gs=$(echo "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("generation_seconds"))' 2>/dev/null)
  check "generate $a returns id" "$([ -n "$id" ] && echo ok)" ok
  check "generate $a provenance line" "$prov" yes
  echo "     $a: id=$id gen=${gs}s pcs/voiced=$pcs"
  check "audio $a 200"     "$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" $BASE/audio/$id)" 200
  check "audio $a is wav"  "$(curl -s -H "$AUTH" $BASE/audio/$id | head -c 4)" RIFF
  check "pcs by id $a 200" "$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" -X POST "$BASE/pcs?generation_id=$id")" 200
done
# upload path: re-score the last generated file as an upload
tmp=$(mktemp).wav; curl -s -H "$AUTH" $BASE/audio/$id -o $tmp
check "pcs upload 200" "$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" -F "file=@$tmp" $BASE/pcs)" 200; rm -f $tmp
# queue: 6 concurrent 3-second requests → the 3-slot queue must refuse at least one with 429
codes=$(for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w '%{http_code}\n' -H "$AUTH" -H 'content-type: application/json' -d '{"prompt":"a slow oud piece","duration":3,"adapter":"oud"}' $BASE/generate & done; wait)
check "queue refuses overflow (some 429)" "$(echo "$codes" | grep -c 429 | awk '{print ($1>=1)?"yes":"no"}')" yes
echo "     queue codes: $(echo $codes | tr '\n' ' ')"
check "demo page 200" "$(curl -s -o /dev/null -w '%{http_code}' $BASE/demo)" 200
check "bound on 0.0.0.0? (must be no)" "$(lsof -nP -iTCP:$PORT -sTCP:LISTEN | grep -c '\*:'$PORT)" 0
echo "listening on: $(lsof -nP -iTCP:$PORT -sTCP:LISTEN | awk 'NR>1{print $9}' | tr '\n' ' ')"
echo "== $pass passed, $fail failed =="
[ $fail -eq 0 ]
