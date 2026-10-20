#!/usr/bin/env bash
# 使い方: scripts/start-server.sh  （環境変数 LLAMA_URL, PORT(既定8787) で切替）
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8788}"
export PORT
# 自分が起動した jev サーバ（index.ts）だけを止める。他プロセスのポートは奪わない。
OLD=$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$OLD" ]; then
  if ps -o command= -p $OLD | grep -q "index.ts"; then echo "stopping existing jev server :$PORT ($OLD)"; kill $OLD; sleep 1
  else echo "port $PORT is used by another process ($OLD): $(ps -o command= -p $OLD | cut -c1-120)"; exit 1; fi
fi
mkdir -p "$DIR/logs"
cd "$DIR/server" && nohup bun run index.ts > "$DIR/logs/server-$PORT.log" 2>&1 &
echo $! > "$DIR/logs/server-$PORT.pid"
for i in $(seq 1 20); do
  curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && { echo "server ready pid=$(cat "$DIR/logs/server-$PORT.pid") port=$PORT"; exit 0; }
  sleep 0.5
done
echo "server failed"; tail -20 "$DIR/logs/server-$PORT.log"; exit 1
