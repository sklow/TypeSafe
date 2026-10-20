#!/usr/bin/env bash
# 日本語・英語の state に choice/score/noul を混ぜて /v1/systemone を叩き、見やすく表示する。
URL="${JEV_URL:-http://127.0.0.1:8788}"
JQ='
  "  latency: \(.x_debug.latency_ms) ms   model: \(.model)   tokens in/out: \(.usage.input_tokens)/\(.usage.output_tokens)",
  (.answers | to_entries[] | . as $e | $e.value as $v | $e.key as $k |
    "  ▸ \($k)  [\($v.type)]",
    ( if $v.type == "choice" then
        "      → \($v.choice)   confidence \($v.confidence*100|round)%",
        "      " + ($v.probabilities | to_entries | sort_by(-.value) | .[:5] | map("\(.key) \(.value*100|round)%") | join("  |  "))
      elif $v.type == "score" then
        "      → score \($v.score*100|round/100)   confidence \($v.confidence*100|round)%",
        "      " + ($v.probabilities | to_entries | map("\(.key):\(.value*100|round)%") | join("  "))
      else "      → P(yes) \($v.noul*1000|round/10)%" end )
  ),
  "  (mass_on_labels: " + (.x_debug.questions | to_entries | map("\(.key)=\(.value.mass_on_labels*100|round)%") | join(" ")) + ")"'
TMP=$(mktemp)
run() {
  echo; echo "=== $1 ==="
  curl -s "$URL/v1/systemone" -H "content-type: application/json" -d "$2" > "$TMP"; jq -r "$JQ" "$TMP" || cat "$TMP"
}

run "日本語 state（レビュー文）" '{
  "state": "先週末に家族で行ったレストラン。料理はどれも絶品で、特にデザートが感動的だった。ただ、予約していたのに30分も待たされ、店員の対応は少し雑だった。",
  "questions": {
    "sentiment": {"type":"choice","instructions":"この投稿の全体的な感情はどれか","criteria":{"ポジティブ":null,"ネガティブ":null,"中立":null,"混合":"良い点も悪い点もある"}},
    "food_quality": {"type":"score","instructions":"料理の質への評価は？","criteria":["悪い","普通","良い","非常に良い"]},
    "has_wait": {"type":"noul","instructions":"この投稿者は待たされたと述べていますか"},
    "mentions_price": {"type":"noul","instructions":"この投稿は価格について言及していますか"}
  }}'

run "English state (support ticket)" '{
  "state": {"from":"customer","subject":"Charged twice","body":"I was billed two times for my March subscription and nobody has answered my emails for a week. Please fix this ASAP or I will cancel."},
  "questions": {
    "category": {"type":"choice","instructions":"Which team should handle this ticket?","criteria":{"billing":"Payments, invoicing, refunds","technical":"Bugs, outages","sales":"Pricing, upgrades","legal":null}},
    "urgency": {"type":"score","instructions":"How urgent is this ticket?","criteria":["not urgent","low","medium","high","critical"]},
    "churn_risk": {"type":"noul","instructions":"Is the customer threatening to leave?"},
    "wants_cash_refund": {"type":"noul","instructions":"Does the customer explicitly ask for a cash refund?"}
  }}'

run "ambiguous question (should split)" '{
  "state": ["The meeting is at 3pm.", "Bob said he might come, but he was not sure."],
  "questions": { "bob_attends": {"type":"noul","instructions":"Will Bob attend the meeting?"} }}'
