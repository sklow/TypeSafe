# 画像版 Jev 評価結果

自動生成（`bun vision/run.ts`）。サーバ: server-vision（NOUL_STYLE=letter, PERMUTATIONS=2）。レイテンシは concurrency 1、アイテム単位（1 リクエスト＝全質問）の p50。

## モデル × 条件（全質問）

| model | cond | n_q | acc | ECE | AUROC | cov@prec95 | mass_on_labels | flip率 | latency p50 (ms/item) |
|---|---|---|---|---|---|---|---|---|---|
| qwen3.5-9b | pair | 90 | 0.844 | 0.075 | 0.787 | 0.533 | 0.999 | 0.167 | 35366 |
| qwen3.5-9b | pair-swap | 90 | 0.722 | 0.103 | 0.756 | 0.189 | 0.999 | 0.211 | 34396 |
| qwen3.5-9b | single | 25 | 0.960 | 0.082 | 0.958 | 1.000 | 0.998 | 0.040 | 3795 |
| qwen3.5-9b | text-only | 115 | 0.356 | 0.455 | 0.548 | 0.000 | 0.998 | 0.087 | 1830 |
| qwen3.5-9b-512 | pair | 90 | 0.833 | 0.085 | 0.763 | 0.467 | 0.999 | 0.211 | 10734 |
| qwen3.5-9b-512 | pair-swap | 90 | 0.711 | 0.144 | 0.706 | 0.122 | 0.999 | 0.189 | 10744 |

## relation 別 正答率（全質問 / __same 質問）

| model | cond | same | opposite | unrelated | __same: same | __same: opposite | __same: unrelated |
|---|---|---|---|---|---|---|---|
| qwen3.5-9b | pair | 0.967 | 0.567 | 1.000 | 1.000 | 0.500 | 1.000 |
| qwen3.5-9b | pair-swap | 1.000 | 0.300 | 0.867 | 1.000 | 0.400 | 1.000 |
| qwen3.5-9b | text-only | 0.933 | 0.067 | 0.000 | 1.000 | 0.000 | 0.000 |
| qwen3.5-9b-512 | pair | 0.933 | 0.567 | 1.000 | 0.900 | 0.600 | 1.000 |
| qwen3.5-9b-512 | pair-swap | 1.000 | 0.300 | 0.833 | 1.000 | 0.400 | 1.000 |

## opposite を same と誤認したとき（__same 質問）

| model | cond | n_opposite | 誤認数 | 誤認率 | 誤認時の平均確信度 |
|---|---|---|---|---|---|
| qwen3.5-9b | pair | 10 | 5 | 0.500 | 0.736 |
| qwen3.5-9b | pair-swap | 10 | 6 | 0.600 | 0.746 |
| qwen3.5-9b | text-only | 10 | 10 | 1.000 | 0.817 |
| qwen3.5-9b-512 | pair | 10 | 4 | 0.400 | 0.762 |
| qwen3.5-9b-512 | pair-swap | 10 | 6 | 0.600 | 0.691 |

## KV キャッシュ再利用（同一リクエスト再送）

**qwen3.5-9b**

- cold: 48322 ms, input_tokens=12636, cache_n=[[86,2068],[86,86],[86,86]]
- warm(同一リクエスト再送): 48395 ms, input_tokens=12636, cache_n=[[86,2068],[86,86],[86,86]]

**qwen3.5-9b-512**

- cold: 11090 ms, input_tokens=4728, cache_n=[[0,750],[86,86],[86,86]]
- warm(同一リクエスト再送): 10953 ms, input_tokens=4728, cache_n=[[86,750],[86,86],[86,86]]


## 注記

- pair-swap は画像の提示順のみ入替（名前と役割＝図A=論文図は不変）。pair との差が位置バイアス。
- text-only は画像なし。pair/single より大きく劣れば「画像を見ないと解けない」ことの確認になる。
- __same は全 pair アイテムに自動追加した標準質問（gold=gold_same_conclusion）。
- noul の probs=[P(no),P(yes)]。confidence = argmax 確率（確率分布の最大値）。
