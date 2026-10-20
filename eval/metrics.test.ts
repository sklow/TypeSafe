import { test, expect } from "bun:test";
import { T_GRID, T_GRID_OLD, bootstrapCI, eceMass, evaluatePooled, poolCalibT, labelBias, accuracy, auroc, brier, coverageAt, ece, evalBlock, fitTemperature, macroF1, maxCoverageAtPrecision, nll, percentile, scaleProbs, argmax } from "./metrics";

const near = (a: number, b: number, e = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(e);

test("ECE: 手計算 4 件（既定 10 bin）", () => {
  // bin9: conf .95 x2 acc 1 -> .05*.5 ; bin6: conf .65 x2 acc .5 -> .15*.5 ; 合計 0.10
  near(ece([0.95, 0.95, 0.65, 0.65], [true, true, false, true]), 0.1);
  near(ece([1.0, 1.0], [true, false]), 0.5); // conf=1.0 は最終 bin、acc .5
  near(ece([0.8], [true]), 0.2);
});

test("Brier 多クラス: 手計算 2 件", () => {
  // 0.14 と 1.46 の平均 = 0.80
  near(brier([[0.7, 0.2, 0.1], [0.1, 0.1, 0.8]], [0, 1]), 0.8);
  near(brier([[1, 0, 0]], [0]), 0);
  near(brier([[0, 1, 0]], [0]), 2);
});

test("NLL とクリップ", () => {
  near(nll([[0.7, 0.3], [0.1, 0.9]], [0, 0]), (-Math.log(0.7) - Math.log(0.1)) / 2);
  near(nll([[0, 1]], [0]), -Math.log(1e-12));
});

test("AUROC", () => {
  near(auroc([0.9, 0.8, 0.3, 0.2], [true, true, false, false])!, 1);
  near(auroc([0.5, 0.5, 0.5, 0.5], [true, true, false, false])!, 0.5);
  near(auroc([0.6, 0.4, 0.5], [true, true, false])!, 0.5);
  near(auroc([0.1, 0.2, 0.9, 0.8], [true, true, false, false])!, 0);
  expect(auroc([0.5, 0.6], [true, true])).toBeNull();
});

test("macro-F1", () => {
  // class0 F1=2/3, class1 F1=0.8
  near(macroF1([0, 1, 1, 1], [0, 0, 1, 1], 2), (2 / 3 + 0.8) / 2);
  // gold にも pred にも現れないクラスは除外
  near(macroF1([0, 0], [0, 0], 3), 1);
  near(accuracy([0, 1, 1], [0, 0, 1]), 2 / 3);
});

test("選択的予測: coverage@0.9 と max coverage@precision>=95%", () => {
  const conf = [0.99, 0.97, 0.95, 0.9, 0.5], ok = [true, true, false, true, false];
  const c = coverageAt(conf, ok, 0.9);
  near(c.coverage, 0.8); near(c.precision!, 0.75);
  expect(coverageAt(conf, ok, 0.999).precision).toBeNull();
  // prefix precision: 1, 1, .667, .75, .6 -> 95% を満たす最大 prefix は 2 件 = 0.4
  near(maxCoverageAtPrecision(conf, ok, 0.95), 0.4);
  // precision は単調でない: 先頭 1 件は 1.0, 2 件で 0.5 に落ちるが 20 件で 19/20=.95 に回復 -> 最大 coverage 1.0
  const conf2 = Array.from({ length: 20 }, (_, i) => 1 - i * 0.01);
  const ok2 = Array.from({ length: 20 }, (_, i) => i !== 1);
  near(maxCoverageAtPrecision(conf2, ok2, 0.95), 1.0);
  // 満たす prefix が無ければ 0
  near(maxCoverageAtPrecision([0.9, 0.8], [false, false], 0.95), 0);
  // 同値 conf は一括採用: [.9 correct, .9 wrong] -> prefix 1 は評価しない。precision .5 < .95 -> 0
  near(maxCoverageAtPrecision([0.9, 0.9], [true, false], 0.95), 0);
});

test("percentile (線形補間)", () => {
  near(percentile([1, 2, 3, 4], 0.5), 2.5);
  near(percentile([1, 2, 3, 4, 5], 0.9), 4.6);
});

test("temperature scaling", () => {
  near(scaleProbs([0.7, 0.3], 1).reduce((a, b) => a + b), 1);
  near(scaleProbs([0.7, 0.3], 1)[0], 0.7);
  expect(scaleProbs([0.7, 0.3], 100)[0]).toBeLessThan(0.51); // T 大 -> 一様に近づく
  // 過信: 常に 0.99 だが正解率 70% -> T>1 が選ばれ NLL が下がる
  const probs = Array.from({ length: 20 }, () => [0.99, 0.01]);
  const gold = Array.from({ length: 20 }, (_, i) => (i < 14 ? 0 : 1));
  const T = fitTemperature(probs, gold);
  expect(T).toBeGreaterThan(1);
  expect(nll(probs.map((p) => scaleProbs(p, T)), gold)).toBeLessThan(nll(probs, gold));
  // 既に較正済みなら T≈1、calib 空なら 1
  // 既に較正済み: p=[.7,.3] で gold が 0 の割合 70%
  const g2 = [0, 0, 0, 0, 0, 0, 0, 1, 1, 1];
  const p2 = Array.from({ length: 10 }, () => [0.7, 0.3]);
  near(fitTemperature(p2, g2), 1, 0.06);
  expect(fitTemperature([], [])).toBe(1);
});

test("evalBlock: score の MAE は 1 始まり規約 (gold index 2 = level 3)", () => {
  const b = evalBlock([[0, 0, 0, 1, 0]], [2], "score", 5);
  near(b.score!.mae_expected, 1); // expected=4, gold=3
  near(b.score!.mae_argmax, 1);   // pred index 3, gold index 2
  near(b.score!.acc_off_by_one, 1);
  const b2 = evalBlock([[0.5, 0, 0, 0, 0.5]], [2], "score", 5);
  near(b2.score!.mae_expected, 0); // expected=3
  expect(argmax([0.1, 0.7, 0.2])).toBe(1);
  near(b2.score!.acc_off_by_one, 0);
});

test("labelBias: 予測分布と gold 分布の TV 距離", () => {
  const b = labelBias([0, 0, 0, 1], [0, 1, 1, 1], 2);
  expect(b.pred_counts).toEqual([3, 1]); expect(b.gold_counts).toEqual([1, 3]);
  near(b.tv, 0.5); near(b.pred_max_share, 0.75); expect(b.pred_max_class).toBe(0);
  expect(b.top_confusions[0]).toEqual({ gold: 1, pred: 0, n: 2 });
  near(labelBias([0, 1, 2], [2, 0, 1], 3).tv, 0); // 分布が同じなら 0（誤答でも偏りなし）
});

test("等質量 bin ECE", () => {
  // 2 bin: [.1,.2] acc 0 -> .15*.5, [.3,.4] acc 1 -> .65*.5 => 0.4
  near(eceMass([0.1, 0.2, 0.3, 0.4], [false, false, true, true], 2), 0.4);
  // 入力順に依存しない
  near(eceMass([0.4, 0.1, 0.3, 0.2], [true, false, true, false], 2), 0.4);
  // 完全較正（各 bin で acc = 平均 conf）に近いデータなら 0
  near(eceMass([0.5, 0.5], [true, false], 1), 0);
});

test("bootstrap CI: 決定的・点推定を含む・退化ケース", () => {
  const conf = Array.from({ length: 50 }, (_, i) => 0.5 + i / 100), ok = conf.map((_, i) => i % 3 !== 0);
  const acc = (c: number[], k: boolean[]) => k.filter(Boolean).length / k.length;
  const a = bootstrapCI(conf, ok, acc), b = bootstrapCI(conf, ok, acc);
  expect(a).toEqual(b); // seed 固定
  const point = acc(conf, ok);
  expect(a[0]).toBeLessThanOrEqual(point); expect(a[1]).toBeGreaterThanOrEqual(point);
  expect(a[1] - a[0]).toBeGreaterThan(0.05); expect(a[1] - a[0]).toBeLessThan(0.4); // n=50, p≈.66 -> 幅 ≈ ±.13
  expect(bootstrapCI([0.9, 0.9, 0.9], [true, true, true], acc)).toEqual([1, 1]);
});

test("プール T: 全タスクの calib をまとめて fit し、test をプール評価", () => {
  const mk = (task: string, split: "calib" | "test", p: number[], gold: number): any => ({ id: `${task}-${split}-${Math.random()}`, task, split, type: "choice", K: p.length, gold, probs: p, pred: 0, conf: Math.max(...p), latency_ms: 1, format_ok: true });
  // 2 タスク（K=2 と K=3）。どちらも過信（0.99）で正解率 70% の calib
  const over = (task: string, K: number) => Array.from({ length: 20 }, (_, i) => mk(task, "calib", [0.99, ...Array(K - 1).fill(0.01 / (K - 1))], i < 14 ? 0 : 1));
  const tests = (task: string, K: number) => Array.from({ length: 10 }, (_, i) => mk(task, "test", [0.99, ...Array(K - 1).fill(0.01 / (K - 1))], i < 7 ? 0 : 1));
  const A = [...over("a", 2), ...tests("a", 2)], B = [...over("b", 3), ...tests("b", 3)];
  const { T, n_calib } = poolCalibT([A, B]);
  expect(n_calib).toBe(40); expect(T).toBeGreaterThan(1);
  const pe = evaluatePooled([A, B], T)!;
  expect(pe.n_test).toBe(20); expect(pe.n_tasks).toBe(2);
  expect(pe.pooled_T.ece).toBeLessThan(pe.raw.ece); // 過信が是正される
  near(pe.raw.accuracy, 0.7);
});

test("T grid 拡張: 極端な過信には 5 超の T が選ばれ、旧 grid は 5 で頭打ち", () => {
  expect(Math.max(...T_GRID)).toBe(20); expect(Math.min(...T_GRID)).toBeCloseTo(0.1); expect(Math.max(...T_GRID_OLD)).toBe(5);
  // 常に p=[1-1e-9, 1e-9] だが正解率 70%: 最適 T は 5 を大きく超える
  const probs = Array.from({ length: 50 }, () => [1 - 1e-9, 1e-9]), gold = Array.from({ length: 50 }, (_, i) => (i < 35 ? 0 : 1));
  expect(fitTemperature(probs, gold, T_GRID_OLD)).toBe(5);
  const T = fitTemperature(probs, gold);
  expect(T).toBeGreaterThan(5);
  expect(nll(probs.map((p) => scaleProbs(p, T)), gold)).toBeLessThan(nll(probs.map((p) => scaleProbs(p, 5)), gold));
});
