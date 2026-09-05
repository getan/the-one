#!/bin/zsh
set -u
ROOT=/Users/quant/work/harness/the-zeroth-docs/apps/agent-board
PORT=8081
BASE=http://127.0.0.1:$PORT
LOG=/tmp/board_accept.log
: > $LOG
step() { echo "$1" | tee -a $LOG; }
export AGENT_BOARD_PORT=$PORT
export AGENT_BOARD_DATA=$(mktemp -d /tmp/board-accept-data-XXXX)
export AGENT_BOARD_WORKDIR=$(mktemp -d /tmp/board-accept-work-XXXX)
cd $ROOT
node server.js >> $LOG 2>&1 &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null" EXIT
for i in $(seq 1 50); do
  if curl -sf $BASE/health >> $LOG 2>&1; then break; fi
  sleep 0.2
done
step "HEALTH: $(curl -s $BASE/health)"
CREATE=$(curl -s -X POST $BASE/api/sessions -H 'content-type: application/json' -d '{"prompt":"Reply with exactly the single line: BOARD_OK"}')
SID=$(printf '%s' "$CREATE" | python3 -c "import json,sys; print(json.load(sys.stdin)['session']['id'])")
step "SESSION: $SID"
for i in $(seq 1 75); do
  STATUS=$(curl -s $BASE/api/sessions/$SID | python3 -c "import json,sys; print(json.load(sys.stdin)['session']['status'])")
  if [ "$STATUS" != "running" ]; then break; fi
  sleep 2
done
step "FINAL_STATUS: $STATUS"
step "LOGS: $(curl -s "$BASE/api/sessions/$SID/logs?tail=30" | python3 -c "import json,sys; print(chr(10).join(json.load(sys.stdin)['lines'][-8:]))")"
step "WEB: $(curl -s $BASE/ | grep -c 'Agent Board') hits"
step "BLUEPRINTS: $(curl -s $BASE/api/blueprints)"
if [ "$STATUS" = "done" ]; then step "ACCEPT: PASS"; else step "ACCEPT: FAIL"; fi
