#!/usr/bin/env bash
# 使い方: scripts/bench.sh [N=10] [same|vary]   state 1つ × 3質問のレイテンシ(ms)を N 回測り p50 を表示
N="${1:-10}"; MODE="${2:-same}"; URL="${JEV_URL:-http://127.0.0.1:8788}"
body() { cat <<JSON
{"state":"Ticket #$1: The customer says they were billed twice for March and nobody replied to emails for a week. They threaten to cancel.",
 "questions":{
  "team":{"type":"choice","instructions":"Which team should handle this?","criteria":{"billing":null,"technical":null,"sales":null,"legal":null}},
  "urgency":{"type":"score","instructions":"How urgent is it?","criteria":["low","medium","high","critical"]},
  "churn":{"type":"noul","instructions":"Is the customer threatening to leave?"}}}
JSON
}
curl -s "$URL/v1/systemone" -H 'content-type: application/json' -d "$(body 0)" >/dev/null   # warm-up
L=()
for i in $(seq 1 "$N"); do
  id=0; [ "$MODE" = vary ] && id=$i
  L+=("$(curl -s "$URL/v1/systemone" -H 'content-type: application/json' -d "$(body $id)" | jq .x_debug.latency_ms)")
done
printf '%s\n' "${L[@]}" | sort -n | awk '{a[NR]=$1} END{printf "n=%d  min=%d  p50=%.0f  max=%d  (ms)\n", NR, a[1], (a[int((NR+1)/2)]+a[int(NR/2+1)])/2, a[NR]}'
