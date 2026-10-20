**事前登録日時**: 2026-10-07 00:00:41 JST

# 「Jev 的に使える」合否基準（事前登録）

本基準は Qwen3.5-2B/4B/9B 等の本番評価結果を見る前に固定する。0.8B の試走（各タスク10件）は実施済みだが本番結果は未確認。

## 判定区分
- A「Jev 相当」: 全ゲート通過（較正は素の確率のまま）
- B「1回の較正で Jev 的に使える」: 精度・形式・選択的精度・レイテンシのゲートを通過し、較正ゲートはモデル単一温度 T（全タスク calib 240件プールで fit）適用後に通過
- C「不可」: 上記以外
- 結論 = A または B を満たす最小モデル。

## ゲート（test 160件/タスク）
1. 形式: mass_on_labels 平均 ≥ 0.95、format 違反 < 2%、エラー 0
2. 精度（絶対値）: boolq ≥ 0.75 / marc_ja_positive ≥ 0.85 / ag_news ≥ 0.80 / sst5 argmax ≥ 0.45 かつ off-by-one ≥ 0.85 / banking77_15 ≥ 0.75 / massive_ja_15 ≥ 0.70
3. 較正: プール test 960件の ECE（10 bin）≤ 0.06 を主ゲート。タスク別は bootstrap 95% CI 上限 ≤ 0.12。
4. 選択的精度: precision ≥ 95% を満たす最大 coverage ≥ 50%（boolq, marc_ja, ag_news）、≥ 30%（banking77_15, massive_ja_15, sst5）。AUROC ≥ 0.75。
5. レイテンシ（Apple M6 / llama.cpp / Q4_K_M）: 1質問 warm p50 ≤ 500ms、3質問（noul+choice+score, 約300トークン state）warm p50 ≤ 1s。cold は参考値。

## 比較上の注意
- Jev 本体の公表値（第三者 ECE 0.06〜0.16、Banking77 77クラス中央値 0.81、公式 evals 67.8%）とは同一 split ではないため「指標的比較」に留める。
- タスク別 T は上限参考値。本線はモデル単一 T。
- 構造差: ローカル実装は llama.cpp のスロット間で KV を共有しないため「1 state を一度だけ処理」は未達（cold は質問数ぶん prefill）。
- 未検証: base vs instruct、量子化（Q4）の較正への影響、選択肢 27〜255 の大規模 choice。
- 位置バイアスは 4B の 15択2タスクで選択肢逆順評価を1回行い報告。
