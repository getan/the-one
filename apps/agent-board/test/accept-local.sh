#!/bin/zsh
set -u
ROOT=/Users/quant/work/harness/the-zeroth-docs/apps/agent-board
PORT=${AGENT_BOARD_PORT:-18099}
BASE=http://127.0.0.1:$PORT
PASS=0
FAIL=0
check() {
  if [ "$2" = "0" ]; then PASS=$((PASS + 1)); echo "PASS: $1"; else FAIL=$((FAIL + 1)); echo "FAIL: $1"; fi
}
export AGENT_BOARD_MOCK=1
export AGENT_BOARD_PORT=$PORT
export AGENT_BOARD_DATA=$(mktemp -d /tmp/board-accept-data-XXXX)
export AGENT_BOARD_WORKDIR=$(mktemp -d /tmp/board-accept-work-XXXX)
export AGENT_BOARD_TEMPLATES=$ROOT/templates
cd $ROOT
node server.js >/tmp/board-accept-server.log 2>&1 &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null" EXIT
for i in $(seq 1 50); do curl -sf $BASE/health >/dev/null 2>&1 && break; sleep 0.2; done
[ "$(curl -s $BASE/health | python3 -c "import json,sys; print(json.load(sys.stdin)['mode'])")" = "mock" ]; check "health reports mock mode" $?
[ "$(curl -s $BASE/api/presets | python3 -c "import json,sys; print(len(json.load(sys.stdin)['presets']))")" = "4" ]; check "four presets served" $?
SID=$(curl -s -X POST $BASE/api/sessions -H 'content-type: application/json' -d '{"prompt":"acceptance probe","preset":"echo"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['session']['id'])")
for i in $(seq 1 50); do [ "$(curl -s $BASE/api/sessions/$SID | python3 -c "import json,sys; print(json.load(sys.stdin)['session']['status'])")" != "running" ] && break; sleep 0.2; done
curl -s "$BASE/api/sessions/$SID/logs?tail=20" | grep -q mock; check "session runs to logs" $?
KID=$(curl -s -X POST $BASE/api/sessions -H 'content-type: application/json' -d '{"prompt":"kill me"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['session']['id'])")
curl -s -X POST $BASE/api/sessions/$KID/kill >/dev/null
[ "$(curl -s $BASE/api/sessions/$KID | python3 -c "import json,sys; print(json.load(sys.stdin)['session']['status'])")" != "running" ]; check "kill settles session" $?
RID=$(curl -s -X POST $BASE/api/blueprints/chain-smoke/run -H 'content-type: application/json' -d '{"input":""}' | python3 -c "import json,sys; print(json.load(sys.stdin)['run']['id'])")
sleep 4
curl -s $BASE/api/runs/$RID/timeline | python3 -c "import json,sys; d=json.load(sys.stdin); t=[e['type'] for e in d['events']]; assert t[0]=='run.started' and t[-1]=='run.finished' and 'handoff.injected' in t and all(s['status']=='done' for s in d['run']['sessions'])"; check "smoke chain ordered and done" $?
curl -s $BASE/ | grep -q -E 'id="graph"'; check "web page has graph canvas" $?
curl -s $BASE/ | grep -q -E 'id="timeline"'; check "web page has timeline" $?
echo "ACCEPT: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
