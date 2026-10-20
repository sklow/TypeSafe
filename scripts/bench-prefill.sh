#!/usr/bin/env bash
# 長い state(約N語)×4質問の cold(毎回別state)/warm(同一state) レイテンシ p50 を測る。
# 使い方: scripts/bench-prefill.sh [N=10] [words=1200]   （WARM_FIRST は start-server.sh 側の環境変数で切替）
N="${1:-10}"; W="${2:-1200}"; URL="${JEV_URL:-http://127.0.0.1:8788}"
body() { python3 - "$1" "$W" <<'PY'
import sys,json,random
seed,W=int(sys.argv[1]),int(sys.argv[2]); random.seed(seed)
words="invoice customer refund delay order account payment support shipping product warranty error login ticket manager report".split()
doc=" ".join(random.choice(words) for _ in range(W))
print(json.dumps({"state":{"id":seed,"text":doc+" The customer was charged twice and wants a refund."},"questions":{
 "team":{"type":"choice","instructions":"Which team?","criteria":{"billing":None,"technical":None,"sales":None,"legal":None}},
 "urgency":{"type":"score","instructions":"How urgent?","criteria":["low","medium","high","critical"]},
 "refund":{"type":"noul","instructions":"Does the customer want a refund?"},
 "angry":{"type":"noul","instructions":"Is the customer angry?"}}}))
PY
}
p50() { sort -n | awk '{a[NR]=$1} END{printf "p50=%.0f min=%d max=%d", (a[int((NR+1)/2)]+a[int(NR/2+1)])/2, a[1], a[NR]}'; }
run() { curl -s "$URL/v1/systemone" -H 'content-type: application/json' -d "$1" | jq .x_debug.latency_ms; }
cold=(); for i in $(seq 1 "$N"); do cold+=("$(run "$(body $((1000+RANDOM)))")"); done
b=$(body 7); run "$b" >/dev/null; warm=(); for i in $(seq 1 "$N"); do warm+=("$(run "$b")"); done
echo "cold(新state): $(printf '%s\n' "${cold[@]}" | p50)   warm(同一state): $(printf '%s\n' "${warm[@]}" | p50)  ms"
