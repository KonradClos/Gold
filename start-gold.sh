#!/bin/bash
set -e
APP_DIR="/home/konrad/Projects/shared/Gold"
PORT=8091
LOG_FILE="/tmp/gold-portfolio-server.log"
PID_FILE="/tmp/gold-portfolio-server.pid"

if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "$OLD_PID" ]; then
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
fi

pkill -f "http.server 8091" 2>/dev/null || true
sleep 1

nohup python3 -m http.server 8091 --directory "$APP_DIR" > "$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"
sleep 2

python3 - <<'PY'
from pathlib import Path
p = Path('/home/konrad/Projects/shared/Gold/index.html')
print('INDEX_EXISTS=', p.exists())
print('INDEX_PATH=', p)
PY

curl -I http://127.0.0.1:8091/ || true
curl -I http://127.0.0.1:8091/index.html || true
xdg-open "http://127.0.0.1:8091/"
