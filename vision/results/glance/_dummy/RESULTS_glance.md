# Glance 評価結果（自動生成: vision/run_glance.py）

指標は eval/metrics.ts と同定義（ECE 10 等幅 bin、AUROC=confidence による正誤判別、cov@prec95）。noul は [P(no),P(yes)]、choice は options 順の確率。
レイテンシは concurrency 1、アイテム単位（1 リクエスト＝全質問）の p50。

## 構成 × 条件（全質問）

| run | cond | n_q | acc | ECE | AUROC | cov@prec95 | mean_conf | latency p50 (ms/item) |
|---|---|---|---|---|---|---|---|---|
| mlx2b-en | pair | 3 | 1.000 | 0.236 | - | 1.000 | 0.764 | 1706 |
| mlx2b-en | pair-swap | 3 | 1.000 | 0.124 | - | 1.000 | 0.876 | 588 |
| mlx2b-en | single | 1 | 1.000 | 0.329 | - | 1.000 | 0.671 | 556 |

## relation 別正答率（全質問 / 「同じ結論か」質問のみ）

| run | cond | same | opposite | unrelated | same-Q same | same-Q opposite | same-Q unrelated | opposite→same誤認率 |
|---|---|---|---|---|---|---|---|---|
| mlx2b-en | pair | - | 1.000 | - | - | 1.000 | - | 0.000 |
| mlx2b-en | pair-swap | - | 1.000 | - | - | 1.000 | - | 0.000 |

## 質問タイプ別 acc

| run | cond | choice | noul |
|---|---|---|---|
| mlx2b-en | pair | 1.000 (n=2) | - (n=-) |
| mlx2b-en | pair-swap | 1.000 (n=2) | - (n=-) |
| mlx2b-en | single | - (n=-) | 1.000 (n=1) |
