# TypeSafeAI — Jev ローカル再現

llama.cpp 上で公式 Jev (`POST /v1/systemone`) 互換 API を再現する。仕様は `docs/jev-spec.md`、実験メモは `server/NOTES.md`。

```bash
scripts/start-llama.sh <model.gguf> [8081]   # llama-server 起動（同ポートの llama-server を置換、/health 待ち）
scripts/start-server.sh                       # Jev API (:8788, env: PORT / LLAMA_URL / TOP_N)
scripts/demo.sh                               # choice/score/noul のデモ
scripts/bench.sh 10 same|vary                 # 3 質問のレイテンシ p50
```

## POST /v1/systemone （公式互換 + 独自拡張 x_*）
```jsonc
{ "state": "text" | {..} | [..],
  "model": "任意（無視）",
  "questions": {
    "a": {"type":"choice","instructions":"...","criteria":{"opt1":"説明"|null, "opt2":null}},   // 2..255 択
    "b": {"type":"score","instructions":"...","criteria":["low","mid","high"]},                  // 2..10 段階（添字0始まり）
    "c": {"type":"noul","instructions":"...","criteria":{"true":"..","false":".."}} },          // criteria 任意
  "x_temperature": {"a": 1.0} }          // 独自: 質問キーごとの温度 or 数値。省略=1
→ { "model": "...gguf",
    "answers": {
      "a": {"type":"choice","choice":"opt2","probabilities":{"opt1":0.1,"opt2":0.9},"confidence":0.8},
      "b": {"type":"score","score":1.43,"legend":{"0":"low",..},"probabilities":{"0":..},"confidence":0.35},
      "c": {"type":"noul","noul":0.95} },                // noul に confidence は無い（公式どおり）
    "usage": {"input_tokens":..,"output_tokens":..},
    "x_debug": {"latency_ms":123, "questions": {"a": {"mass_on_labels":0.99,"leak":0.01,"raw_probs":[..],"first_token":"B","T":1,"cache_n":45}}} }
```
- confidence は公式式（choice: (max-1/n)/(1-1/n)、score: 1 - spread/even_spread）。確率は丸めない。
- 質問キーはモデルに送らない。検証エラーは 422 `{"error": "..."}`、llama-server 障害は 502。
- 27〜255 択は 2 段階（群文字→群内文字）。`x_debug.questions.<k>` に `group_probs` / `expanded_groups` / `stage2`。
