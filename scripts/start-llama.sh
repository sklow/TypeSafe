#!/usr/bin/env bash
# 使い方: scripts/start-llama.sh <gguf_path> [port=8081] [ctx=8192] [parallel=1]
# 既定は parallel=1 + 小 ubatch + 細かい checkpoint（state の KV 再利用のため。server/NOTES.md 参照）。
# 既存の llama-server（同ポート）を止めてから起動し、/health が OK になるまで待つ。
set -u
GGUF="${1:?usage: start-llama.sh <gguf_path> [port] [ctx] [parallel]}"
PORT="${2:-8081}"
CTX="${3:-8192}"
PAR="${4:-1}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$DIR/logs/llama-$PORT.log"
mkdir -p "$DIR/logs"

OLD=$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$OLD" ]; then
  if ps -o command= -p $OLD | grep -q "llama-server"; then
    echo "stopping existing llama-server on :$PORT ($OLD)"
    kill $OLD; sleep 2; kill -9 $OLD 2>/dev/null || true
  else echo "port $PORT is used by another process ($OLD): $(ps -o command= -p $OLD | cut -c1-120)"; exit 1; fi
fi

# EXTRA_ARGS で追加フラグを渡せる（例: EXTRA_ARGS="--chat-template-file x.jinja"）
nohup llama-server -m "$GGUF" --jinja -c "$CTX" --parallel "$PAR" --port "$PORT" -ngl 99 \
  ${EXTRA_ARGS--ub 64 -cram 0 --checkpoint-min-step 0} > "$LOG" 2>&1 &
PID=$!
echo "$PID" > "$DIR/logs/llama-$PORT.pid"
echo "llama-server pid=$PID port=$PORT log=$LOG"

for i in $(seq 1 180); do
  if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then echo "ready after ${i}s"; exit 0; fi
  if ! kill -0 "$PID" 2>/dev/null; then echo "llama-server died; tail of log:"; tail -20 "$LOG"; exit 1; fi
  sleep 1
done
echo "timeout waiting for health"; tail -20 "$LOG"; exit 1
