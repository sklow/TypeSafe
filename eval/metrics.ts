// 評価指標。全関数は純粋関数。確率は各行が長さ K の配列（合計 ≈ 1）、gold は 0 始まりのクラス index。
// 規約:
//  - confidence = top-label 確率 (max_k p_k)
//  - ECE: 10 等幅 bin（主指標）、Σ (n_b/N)·|acc_b − conf_b|、conf=1.0 は最終 bin に入れる。併記: 10 等質量 bin 版（ece_mass）
//  - bootstrap 95% CI: アイテム単位の復元抽出 1000 回、seed 固定（accuracy / ECE / max_cov@prec95）
//  - Brier: 多クラス Brier = mean_i Σ_k (p_ik − y_ik)²  （範囲 0〜2）
//  - NLL: −log(max(p_gold, 1e-12)) の平均
//  - macro-F1: gold か pred に一度でも現れたクラスの F1 の平均（現れないクラスは除外）
//  - AUROC: confidence で「正解/不正解」を判別する Mann-Whitney U（同値は 0.5）。片方のクラスしか無ければ null
//  - percentile: 線形補間（numpy 既定と同じ）

export const EPS = 1e-12;

export function argmax(p: number[]): number {
  let b = 0;
  for (let i = 1; i < p.length; i++) if (p[i] > p[b]) b = i;
  return b;
}
export const mean = (a: number[]): number => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

export function accuracy(pred: number[], gold: number[]): number {
  return mean(pred.map((p, i) => (p === gold[i] ? 1 : 0)));
}

export function macroF1(pred: number[], gold: number[], K: number): number {
  const f1s: number[] = [];
  for (let c = 0; c < K; c++) {
    let tp = 0, fp = 0, fn = 0;
    for (let i = 0; i < pred.length; i++) {
      if (pred[i] === c && gold[i] === c) tp++;
      else if (pred[i] === c) fp++;
      else if (gold[i] === c) fn++;
    }
    if (tp + fp + fn === 0) continue; // gold にも pred にも現れない
    const d = 2 * tp + fp + fn;
    f1s.push(d === 0 ? 0 : (2 * tp) / d);
  }
  return mean(f1s);
}

export function ece(conf: number[], correct: boolean[], bins = 10): number {
  const n = conf.length;
  const cnt = new Array(bins).fill(0), sc = new Array(bins).fill(0), sa = new Array(bins).fill(0);
  for (let i = 0; i < n; i++) {
    const b = Math.min(bins - 1, Math.floor(conf[i] * bins));
    cnt[b]++; sc[b] += conf[i]; sa[b] += correct[i] ? 1 : 0;
  }
  let e = 0;
  for (let b = 0; b < bins; b++) if (cnt[b]) e += (cnt[b] / n) * Math.abs(sa[b] / cnt[b] - sc[b] / cnt[b]);
  return e;
}

/** 等質量 bin ECE: conf 昇順に並べ、ほぼ同数ずつ bins 個に分割 */
export function eceMass(conf: number[], correct: boolean[], bins = 10): number {
  const n = conf.length;
  if (!n) return NaN;
  const idx = conf.map((_, i) => i).sort((a, b) => conf[a] - conf[b]);
  let e = 0;
  for (let b = 0; b < bins; b++) {
    const lo = Math.floor((b * n) / bins), hi = Math.floor(((b + 1) * n) / bins);
    if (hi <= lo) continue;
    let sc = 0, sa = 0;
    for (let k = lo; k < hi; k++) { sc += conf[idx[k]]; sa += correct[idx[k]] ? 1 : 0; }
    e += ((hi - lo) / n) * Math.abs(sa / (hi - lo) - sc / (hi - lo));
  }
  return e;
}

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** アイテム単位の bootstrap 95% CI（percentile 法）。stat は resample 後の (conf, correct) から値を返す */
export function bootstrapCI(conf: number[], correct: boolean[], stat: (c: number[], k: boolean[]) => number, B = 1000, seed = 20261007): [number, number] {
  const n = conf.length;
  if (n < 2) return [NaN, NaN];
  const rnd = mulberry32(seed);
  const vals: number[] = [];
  for (let b = 0; b < B; b++) {
    const c: number[] = new Array(n), k: boolean[] = new Array(n);
    for (let i = 0; i < n; i++) { const j = Math.floor(rnd() * n); c[i] = conf[j]; k[i] = correct[j]; }
    vals.push(stat(c, k));
  }
  vals.sort((x, y) => x - y);
  return [percentile(vals, 0.025), percentile(vals, 0.975)];
}

export function brier(probs: number[][], gold: number[]): number {
  return mean(probs.map((p, i) => p.reduce((s, x, k) => s + (x - (k === gold[i] ? 1 : 0)) ** 2, 0)));
}

export function nll(probs: number[][], gold: number[]): number {
  return mean(probs.map((p, i) => -Math.log(Math.max(p[gold[i]], EPS))));
}

export function auroc(conf: number[], correct: boolean[]): number | null {
  const pos: number[] = [], neg: number[] = [];
  conf.forEach((c, i) => (correct[i] ? pos : neg).push(c));
  if (!pos.length || !neg.length) return null;
  let u = 0;
  for (const p of pos) for (const q of neg) u += p > q ? 1 : p === q ? 0.5 : 0;
  return u / (pos.length * neg.length);
}

/** conf >= thr のときの coverage（全体に対する割合）と precision（採用分の正解率。採用 0 件なら null） */
export function coverageAt(conf: number[], correct: boolean[], thr: number): { coverage: number; precision: number | null; n: number } {
  let n = 0, ok = 0;
  for (let i = 0; i < conf.length; i++) if (conf[i] >= thr) { n++; ok += correct[i] ? 1 : 0; }
  return { coverage: n / conf.length, precision: n ? ok / n : null, n };
}

/**
 * precision >= target を満たす最大 coverage。conf 降順に並べ、同値 conf は同時に採用（tie group 境界のみ評価）。
 * precision は prefix 長に対して単調でないので、条件を満たす全 prefix の最大 coverage を取る。満たす prefix が無ければ 0。
 */
export function maxCoverageAtPrecision(conf: number[], correct: boolean[], target: number): number {
  const idx = conf.map((_, i) => i).sort((a, b) => conf[b] - conf[a]);
  let ok = 0, best = 0;
  for (let k = 0; k < idx.length; k++) {
    ok += correct[idx[k]] ? 1 : 0;
    const boundary = k === idx.length - 1 || conf[idx[k + 1]] !== conf[idx[k]];
    if (boundary && ok >= target * (k + 1) - 1e-12) best = k + 1;
  }
  return best / conf.length;
}

export function percentile(a: number[], q: number): number {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

// ---- temperature scaling ----
/** softmax(log p / T)。p は EPS でクリップ */
export function scaleProbs(p: number[], T: number): number[] {
  const l = p.map((x) => Math.log(Math.max(x, EPS)) / T);
  const m = Math.max(...l);
  const e = l.map((x) => Math.exp(x - m));
  const z = e.reduce((s, x) => s + x, 0);
  return e.map((x) => x / z);
}
/** 旧 grid（0.25..5.00, 0.05 刻み）。2026-10-07 の拡張前の本線。差分注記のために残す */
export const T_GRID_OLD: number[] = Array.from({ length: 96 }, (_, i) => Math.round((0.25 + 0.05 * i) * 100) / 100);
/** 現行 grid: 0.10..5.00 を 0.05 刻み + 5.5..20 を粗く（gemma のように T>5 が要るモデルのため。上限 5.0 は criteria.md の規定ではなく実装上の制約だった） */
export const T_GRID: number[] = [
  ...Array.from({ length: 99 }, (_, i) => Math.round((0.1 + 0.05 * i) * 100) / 100),
  5.5, 6, 6.5, 7, 8, 9, 10, 12, 14, 16, 18, 20,
];
/** calib で NLL 最小の T。同点は 1.0 に近い方。n=0 なら 1 */
export function fitTemperature(probs: number[][], gold: number[], grid: number[] = T_GRID): number {
  if (!probs.length) return 1;
  let bestT = 1, best = Infinity;
  for (const T of grid) {
    const v = nll(probs.map((p) => scaleProbs(p, T)), gold);
    if (v < best - 1e-12 || (Math.abs(v - best) <= 1e-12 && Math.abs(T - 1) < Math.abs(bestT - 1))) { best = v; bestT = T; }
  }
  return bestT;
}

/** 順序別分布の対数平均（幾何平均を再正規化）。算術平均は x_debug 経由でサーバが既に返す最終確率 */
export function logMean(orders: number[][]): number[] {
  const K = orders[0].length;
  const l = Array.from({ length: K }, (_, k) => mean(orders.map((o) => Math.log(Math.max(o[k], EPS)))));
  const m = Math.max(...l), e = l.map((x) => Math.exp(x - m)), z = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / z);
}
/** 順序間で argmax が食い違うアイテムの割合（orders が 2 つ以上あるアイテムのみ対象。無ければ null） */
export function flipRate(orders: number[][][]): number | null {
  const v = orders.filter((o) => o && o.length > 1);
  if (!v.length) return null;
  return mean(v.map((o) => (o.some((p) => argmax(p) !== argmax(o[0])) ? 1 : 0)));
}
/** 温度 T の bootstrap 95% CI（calib アイテムを復元抽出して再 fit）。B は計算量のため 300 */
export function bootstrapT(probs: number[][], gold: number[], B = 300, seed = 20261007): [number, number] {
  const n = probs.length;
  if (n < 2) return [NaN, NaN];
  const rnd = mulberry32(seed);
  const ts: number[] = [];
  for (let b = 0; b < B; b++) {
    const P: number[][] = [], G: number[] = [];
    for (let i = 0; i < n; i++) { const j = Math.floor(rnd() * n); P.push(probs[j]); G.push(gold[j]); }
    ts.push(fitTemperature(P, G));
  }
  ts.sort((a, b) => a - b);
  return [percentile(ts, 0.025), percentile(ts, 0.975)];
}

// ---- 1 タスク分の評価 ----
export interface Rec {
  id: string; task: string; split: "calib" | "test"; type: "choice" | "score" | "noul";
  K: number; gold: number; probs: number[] | null; pred: number | null; conf: number | null;
  expected?: number | null; latency_ms: number; server_latency_ms?: number | null;
  mass_on_labels?: number | null; server_model?: string | null; orders?: number[][] | null; flip?: boolean | null; format_ok: boolean; error?: string;
}

export interface Block {
  n: number; accuracy: number; macro_f1: number; ece: number; ece_mass: number; brier: number; nll: number;
  ci?: { accuracy: [number, number]; ece: [number, number]; max_cov_at_prec_95: [number, number] };
  auroc: number | null;
  cov_at_0_9: number; prec_at_0_9: number | null;
  max_cov_at_prec_95: number;
  mean_conf: number;
  score?: { mae_expected: number; mae_argmax: number; acc_off_by_one: number };
}

export function evalBlock(probs: number[][], gold: number[], type: Rec["type"], K: number, withCI = false, ordinal = false): Block {
  const pred = probs.map(argmax);
  const conf = probs.map((p, i) => p[pred[i]]);
  const correct = pred.map((p, i) => p === gold[i]);
  const c9 = coverageAt(conf, correct, 0.9);
  const b: Block = {
    n: probs.length, accuracy: accuracy(pred, gold), macro_f1: macroF1(pred, gold, K),
    ece: ece(conf, correct), ece_mass: eceMass(conf, correct), brier: brier(probs, gold), nll: nll(probs, gold), auroc: auroc(conf, correct),
    cov_at_0_9: c9.coverage, prec_at_0_9: c9.precision, max_cov_at_prec_95: maxCoverageAtPrecision(conf, correct, 0.95),
    mean_conf: mean(conf),
  };
  if (withCI) {
    const ind = (c: number[], k: boolean[]) => mean(k.map((x) => (x ? 1 : 0)));
    b.ci = { accuracy: bootstrapCI(conf, correct, ind), ece: bootstrapCI(conf, correct, (c, k) => ece(c, k)), max_cov_at_prec_95: bootstrapCI(conf, correct, (c, k) => maxCoverageAtPrecision(c, k, 0.95)) };
  }
  if (type === "score" || ordinal) {
    const exp = probs.map((p) => p.reduce((s, x, k) => s + x * (k + 1), 0));
    b.score = {
      mae_expected: mean(exp.map((e, i) => Math.abs(e - (gold[i] + 1)))),
      mae_argmax: mean(pred.map((p, i) => Math.abs(p - gold[i]))),
      acc_off_by_one: mean(pred.map((p, i) => (Math.abs(p - gold[i]) <= 1 ? 1 : 0))),
    };
  }
  return b;
}

/** 予測ラベル分布の偏り（位置バイアス検出用）。tv = 予測分布と gold 分布の total variation 距離（0〜1） */
export interface LabelBias {
  pred_counts: number[]; gold_counts: number[]; tv: number; pred_max_share: number; gold_max_share: number;
  pred_max_class: number; top_confusions: { gold: number; pred: number; n: number }[];
}
export function labelBias(pred: number[], gold: number[], K: number): LabelBias {
  const pc = new Array(K).fill(0), gc = new Array(K).fill(0), conf = new Map<string, number>();
  for (let i = 0; i < pred.length; i++) {
    pc[pred[i]]++; gc[gold[i]]++;
    if (pred[i] !== gold[i]) conf.set(`${gold[i]}>${pred[i]}`, (conf.get(`${gold[i]}>${pred[i]}`) ?? 0) + 1);
  }
  const n = pred.length || 1;
  let tv = 0;
  for (let k = 0; k < K; k++) tv += Math.abs(pc[k] - gc[k]) / n;
  const top = [...conf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, c]) => { const [g, p] = k.split(">").map(Number); return { gold: g, pred: p, n: c }; });
  return { pred_counts: pc, gold_counts: gc, tv: tv / 2, pred_max_share: Math.max(...pc) / n, gold_max_share: Math.max(...gc) / n, pred_max_class: argmax(pc), top_confusions: top };
}

export interface TaskEval {
  task: string; type: Rec["type"]; K: number;
  n_total: number; n_err: number; n_format_violation: number;
  test: Block | null; test_Tpool: Block | null; test_Ttask: Block | null; test_Ttype: Block | null; test_logmean: Block | null; flip_rate: number | null;
  T_pool: number; T_task: number; T_type: number; n_calib: number; bias: LabelBias | null;
  majority_baseline_acc: number | null;
  mass_mean: number | null; mass_min: number | null;
  latency_p50: number | null; latency_p90: number | null; server_latency_p50: number | null;
}

export function evaluateTask(recs: Rec[], meta: { type: Rec["type"]; majority_baseline_test_acc?: number; ordinal?: boolean }, task: string, K: number, T_pool = 1, T_type = 1): TaskEval {
  const ok = recs.filter((r) => r.probs && r.format_ok);
  const test = ok.filter((r) => r.split === "test"), calib = ok.filter((r) => r.split === "calib");
  const T_task = fitTemperature(calib.map((r) => r.probs!), calib.map((r) => r.gold));
  const P = (rs: Rec[]) => rs.map((r) => r.probs!), G = (rs: Rec[]) => rs.map((r) => r.gold);
  const masses = recs.map((r) => r.mass_on_labels).filter((x): x is number => typeof x === "number");
  const lat = recs.filter((r) => !r.error).map((r) => r.latency_ms);
  const slat = recs.map((r) => r.server_latency_ms).filter((x): x is number => typeof x === "number");
  return {
    task, type: meta.type, K, n_total: recs.length, n_err: recs.filter((r) => r.error).length,
    n_format_violation: recs.filter((r) => !r.error && !r.format_ok).length,
    test: test.length ? evalBlock(P(test), G(test), meta.type, K, true, !!meta.ordinal) : null,
    test_Tpool: test.length ? evalBlock(P(test).map((p) => scaleProbs(p, T_pool)), G(test), meta.type, K, true, !!meta.ordinal) : null,
    test_Ttask: test.length ? evalBlock(P(test).map((p) => scaleProbs(p, T_task)), G(test), meta.type, K, false, !!meta.ordinal) : null,
    test_Ttype: test.length ? evalBlock(P(test).map((p) => scaleProbs(p, T_type)), G(test), meta.type, K, true, !!meta.ordinal) : null,
    test_logmean: test.length && test.every((r) => r.orders && r.orders.length > 1) ? evalBlock(test.map((r) => logMean(r.orders!)), G(test), meta.type, K, true) : null,
    flip_rate: flipRate(recs.filter((r) => r.probs && r.format_ok).map((r) => r.orders ?? [])),
    T_pool, T_task, T_type, n_calib: calib.length,
    bias: test.length ? labelBias(test.map((r) => argmax(r.probs!)), G(test), K) : null,
    majority_baseline_acc: meta.majority_baseline_test_acc ?? null,
    mass_mean: masses.length ? mean(masses) : null, mass_min: masses.length ? Math.min(...masses) : null,
    latency_p50: lat.length ? percentile(lat, 0.5) : null, latency_p90: lat.length ? percentile(lat, 0.9) : null,
    server_latency_p50: slat.length ? percentile(slat, 0.5) : null,
  };
}

/** モデル単位のプール評価: 全タスクの calib をプールして単一 T を fit し、全タスクの test をプールして評価する。
 *  補足として種別別 T（noul/score/choice 別に calib をプールして fit）も評価する */
export interface PooledEval {
  n_tasks: number; n_calib: number; n_test: number; T_pool: number; T_pool_ci: [number, number];
  T_type: Record<string, { T: number; n_calib: number; ci: [number, number] }>;
  raw: Block; pooled_T: Block; type_T: Block;
}
type TypeName = Rec["type"];
const okRecs = (rs: Rec[]) => rs.filter((r) => r.probs && r.format_ok);
export function poolCalibT(perTask: Rec[][]): { T: number; n_calib: number; ci: [number, number] } {
  const calib = perTask.flatMap((rs) => okRecs(rs).filter((r) => r.split === "calib"));
  const P = calib.map((r) => r.probs!), G = calib.map((r) => r.gold);
  return { T: fitTemperature(P, G), n_calib: calib.length, ci: bootstrapT(P, G) };
}
/** 種別（noul/score/choice）ごとに、その種別の全タスクの calib をプールして T を fit */
export function calibTByType(perTask: Rec[][]): Record<string, { T: number; n_calib: number; ci: [number, number] }> {
  const out: Record<string, { T: number; n_calib: number; ci: [number, number] }> = {};
  for (const ty of ["noul", "score", "choice"] as TypeName[]) {
    const calib = perTask.flatMap((rs) => okRecs(rs).filter((r) => r.split === "calib" && r.type === ty));
    if (!calib.length) continue;
    const P = calib.map((r) => r.probs!), G = calib.map((r) => r.gold);
    out[ty] = { T: fitTemperature(P, G), n_calib: calib.length, ci: bootstrapT(P, G) };
  }
  return out;
}
export function evaluatePooled(perTask: Rec[][], T: number, Ttype: Record<string, number> = {}): PooledEval | null {
  const ok = perTask.flatMap(okRecs);
  const test = ok.filter((r) => r.split === "test");
  if (!test.length) return null;
  const P = test.map((r) => r.probs!), G = test.map((r) => r.gold);
  // プールは種別・K が混在するので macro_f1 / score 指標は無意味（ダミー type/K で計算されるだけ。表示しない）
  return {
    n_tasks: perTask.filter((rs) => rs.some((r) => r.split === "test" && r.probs)).length, n_calib: ok.length - test.length, n_test: test.length,
    T_pool: T, T_pool_ci: [NaN, NaN], T_type: {},
    raw: evalBlock(P, G, "choice", 2, true), pooled_T: evalBlock(P.map((p) => scaleProbs(p, T)), G, "choice", 2, true),
    type_T: evalBlock(test.map((r) => scaleProbs(r.probs!, Ttype[r.type] ?? 1)), G, "choice", 2, true),
  };
}
