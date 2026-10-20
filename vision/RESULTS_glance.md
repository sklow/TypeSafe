# Glance 評価結果（自動生成: vision/run_glance.py）

指標は eval/metrics.ts と同定義（ECE 10 等幅 bin、AUROC=confidence による正誤判別、cov@prec95）。noul は [P(no),P(yes)]、choice は options 順の確率。
レイテンシは concurrency 1、アイテム単位（1 リクエスト＝全質問）の p50。

## 構成 × 条件（全質問）

| run | cond | n_q | acc | ECE | AUROC | cov@prec95 | mean_conf | latency p50 (ms/item) |
|---|---|---|---|---|---|---|---|---|
| mlx2b-ja | pair | 90 | 0.567 | 0.292 | 0.776 | 0.278 | 0.838 | 867 |
| mlx2b-ja | pair-swap | 90 | 0.556 | 0.265 | 0.821 | 0.311 | 0.820 | 853 |
| mlx2b-ja | single | 25 | 0.520 | 0.209 | 0.692 | 0.160 | 0.700 | 621 |
| mlx2b-en | pair | 90 | 0.611 | 0.146 | 0.729 | 0.144 | 0.757 | 819 |
| mlx2b-en | pair-swap | 90 | 0.689 | 0.104 | 0.711 | 0.133 | 0.712 | 794 |
| mlx2b-en | single | 25 | 0.600 | 0.203 | 0.873 | 0.360 | 0.705 | 1138 |
| torch4b-ja | pair | 90 | 0.711 | 0.188 | 0.770 | 0.378 | 0.899 | 1386 |
| torch4b-ja | pair-swap | 90 | 0.722 | 0.188 | 0.775 | 0.400 | 0.906 | 1380 |
| torch4b-ja | single | 25 | 0.600 | 0.308 | 0.853 | 0.480 | 0.889 | 503 |
| torch4b-en | pair | 90 | 0.767 | 0.182 | 0.805 | 0.522 | 0.949 | 1261 |
| torch4b-en | pair-swap | 90 | 0.778 | 0.166 | 0.809 | 0.544 | 0.944 | 1249 |
| torch4b-en | single | 25 | 0.760 | 0.145 | 0.711 | 0.320 | 0.905 | 220 |

## relation 別正答率（全質問 / 「同じ結論か」質問のみ）

| run | cond | same | opposite | unrelated | same-Q same | same-Q opposite | same-Q unrelated | opposite→same誤認率 |
|---|---|---|---|---|---|---|---|---|
| mlx2b-ja | pair | 0.533 | 0.500 | 0.667 | 0.100 | 1.000 | 1.000 | 0.000 |
| mlx2b-ja | pair-swap | 0.500 | 0.500 | 0.667 | 0.100 | 1.000 | 1.000 | 0.000 |
| mlx2b-en | pair | 0.767 | 0.333 | 0.733 | 0.700 | 0.400 | 1.000 | 0.600 |
| mlx2b-en | pair-swap | 0.700 | 0.400 | 0.967 | 0.500 | 0.600 | 1.000 | 0.400 |
| torch4b-ja | pair | 0.633 | 0.633 | 0.867 | 0.300 | 0.900 | 1.000 | 0.100 |
| torch4b-ja | pair-swap | 0.700 | 0.567 | 0.900 | 0.500 | 1.000 | 1.000 | 0.000 |
| torch4b-en | pair | 0.633 | 0.667 | 1.000 | 0.400 | 0.900 | 1.000 | 0.100 |
| torch4b-en | pair-swap | 0.667 | 0.667 | 1.000 | 0.400 | 1.000 | 1.000 | 0.000 |

## 質問タイプ別 acc

| run | cond | choice | noul |
|---|---|---|---|
| mlx2b-ja | pair | 0.500 (n=60) | - (n=-) |
| mlx2b-ja | pair-swap | 0.483 (n=60) | - (n=-) |
| mlx2b-ja | single | 0.643 (n=14) | 0.364 (n=11) |
| mlx2b-en | pair | 0.567 (n=60) | - (n=-) |
| mlx2b-en | pair-swap | 0.683 (n=60) | - (n=-) |
| mlx2b-en | single | 0.500 (n=14) | 0.727 (n=11) |
| torch4b-ja | pair | 0.700 (n=60) | - (n=-) |
| torch4b-ja | pair-swap | 0.667 (n=60) | - (n=-) |
| torch4b-ja | single | 0.643 (n=14) | 0.545 (n=11) |
| torch4b-en | pair | 0.767 (n=60) | - (n=-) |
| torch4b-en | pair-swap | 0.767 (n=60) | - (n=-) |
| torch4b-en | single | 0.643 (n=14) | 0.909 (n=11) |
