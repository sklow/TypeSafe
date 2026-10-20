// docs/criteria.md（事前登録 2026-10-07 00:00:41 JST）の各ゲートを自動判定する。閾値は criteria.md のまま変更しないこと。
//   A: 全ゲートを素の確率で通過 / B: ゲート 3（較正）のみ単一 T（プール calib 240 件で fit）適用後に通過、他は通過 / C: それ以外
import type { Block, PooledEval, TaskEval } from "./metrics";

export const THRESH = {
  mass_mean: 0.95, format_violation_rate: 0.02, errors: 0,
  acc: { boolq: 0.75, marc_ja_positive: 0.85, ag_news: 0.8, sst5: 0.45, banking77_15: 0.75, massive_ja_15: 0.7 } as Record<string, number>,
  sst5_off_by_one: 0.85,
  ece_pooled: 0.06, ece_task_ci_upper: 0.12,
  cov95: { boolq: 0.5, marc_ja_positive: 0.5, ag_news: 0.5, banking77_15: 0.3, massive_ja_15: 0.3, sst5: 0.3 } as Record<string, number>,
  auroc: 0.75,
  lat_1q_warm_p50_ms: 500, lat_3q_warm_p50_ms: 1000,
};
export const TASKS = Object.keys(THRESH.acc);

export interface Gate { pass: boolean | null; fails: string[] } // pass=null: データ欠損で判定不能
export interface Judgement {
  g1: Gate; g2: Gate; g3_raw: Gate; g3_T: Gate; g4: Gate; g5: Gate;
  missing: string[]; verdict: "A" | "B" | "C" | "未判定";
}
const f = (x: number | null | undefined, d = 3) => (x === null || x === undefined || Number.isNaN(x) ? "–" : x.toFixed(d));

function gate(fails: string[], missing: boolean): Gate { return missing ? { pass: null, fails } : { pass: fails.length === 0, fails }; }

export function judge(evals: Record<string, TaskEval>, pooled: PooledEval | null, bench: any | null, tasks: string[] = TASKS): Judgement {
  const missing: string[] = [];
  const have = tasks.filter((t) => evals[t]?.test);
  for (const t of tasks) if (!have.includes(t)) missing.push(`task:${t}`);
  if (!bench) missing.push("latency_bench");
  const incomplete = have.length < tasks.length;

  // 1. 形式
  const g1f: string[] = [];
  for (const t of have) {
    const e = evals[t];
    if (e.mass_mean === null || e.mass_mean < THRESH.mass_mean) g1f.push(`${t}: mass_on_labels 平均 ${f(e.mass_mean)} < ${THRESH.mass_mean}`);
    const v = e.n_format_violation / e.n_total;
    if (v >= THRESH.format_violation_rate) g1f.push(`${t}: format 違反 ${(100 * v).toFixed(1)}% ≥ 2%`);
    if (e.n_err > THRESH.errors) g1f.push(`${t}: エラー ${e.n_err} 件`);
  }
  // 2. 精度（絶対値）。T は argmax を変えないので素/較正後で同一
  const g2f: string[] = [];
  for (const t of have) {
    const b = evals[t].test!;
    if (b.accuracy < THRESH.acc[t]) g2f.push(`${t}: acc ${f(b.accuracy)} < ${THRESH.acc[t]}`);
    if (t === "sst5" && (b.score?.acc_off_by_one ?? 0) < THRESH.sst5_off_by_one) g2f.push(`sst5: off-by-one ${f(b.score?.acc_off_by_one)} < ${THRESH.sst5_off_by_one}`);
  }
  // 3. 較正（素 / 単一 T）
  const g3 = (pick: (e: TaskEval) => Block | null, pb: Block | undefined): string[] => {
    const fl: string[] = [];
    if (!pb) fl.push("プール評価なし");
    else if (pb.ece > THRESH.ece_pooled) fl.push(`プール ECE ${f(pb.ece)} > ${THRESH.ece_pooled}`);
    for (const t of have) { const hi = pick(evals[t])?.ci?.ece[1]; if (hi === undefined || Number.isNaN(hi) || hi > THRESH.ece_task_ci_upper) fl.push(`${t}: ECE CI 上限 ${f(hi)} > ${THRESH.ece_task_ci_upper}`); }
    return fl;
  };
  const g3rawF = g3((e) => e.test, pooled?.raw), g3TF = g3((e) => e.test_Tpool, pooled?.pooled_T);
  // 4. 選択的精度（cov@prec95 と AUROC。cov は素/較正後の両方で判定し、較正後の方を B の判定に使う）
  const g4 = (pick: (e: TaskEval) => Block | null): string[] => {
    const fl: string[] = [];
    for (const t of have) {
      const b = pick(evals[t])!;
      if (b.max_cov_at_prec_95 < THRESH.cov95[t]) fl.push(`${t}: cov@prec95 ${f(b.max_cov_at_prec_95)} < ${THRESH.cov95[t]}`);
      if (b.auroc === null || b.auroc < THRESH.auroc) fl.push(`${t}: AUROC ${f(b.auroc)} < ${THRESH.auroc}`);
    }
    return fl;
  };
  const g4rawF = g4((e) => e.test), g4TF = g4((e) => e.test_Tpool);
  // 5. レイテンシ
  const g5f: string[] = [];
  const l1 = bench?.noul_only_same_state_warm?.client_ms?.p50, l3 = bench?.three_questions_same_state_warm?.client_ms?.p50;
  if (bench) {
    if (!(l1 <= THRESH.lat_1q_warm_p50_ms)) g5f.push(`1 質問 warm p50 ${f(l1, 0)}ms > ${THRESH.lat_1q_warm_p50_ms}`);
    if (!(l3 <= THRESH.lat_3q_warm_p50_ms)) g5f.push(`3 質問 warm p50 ${f(l3, 0)}ms > ${THRESH.lat_3q_warm_p50_ms}`);
  }

  const G1 = gate(g1f, incomplete), G2 = gate(g2f, incomplete), G5 = gate(g5f, !bench);
  const G3raw = gate(g3rawF, incomplete), G3T = gate(g3TF, incomplete);
  // ゲート 4: A 基準 = 素、B 基準 = 較正後。素で落ちて較正後で通るなら A 基準は不通過。ここでは素を表の主列に出し、B 判定は較正後で行う
  const G4 = gate(g4rawF, incomplete), G4T = gate(g4TF, incomplete);
  const unknown = missing.length > 0 || [G1, G2, G5, G3raw, G3T, G4, G4T].some((g) => g.pass === null);
  let verdict: Judgement["verdict"] = "C";
  if (unknown) verdict = "未判定";
  else if (G1.pass && G2.pass && G3raw.pass && G4.pass && G5.pass) verdict = "A";
  else if (G1.pass && G2.pass && G3T.pass && G4T.pass && G5.pass) verdict = "B";
  return { g1: G1, g2: G2, g3_raw: G3raw, g3_T: G3T, g4: G4, g5: G5, missing, verdict };
}
