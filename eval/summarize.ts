// 使い方: bun eval/summarize.ts eval/results/   -> eval/results/SUMMARY.md と summary.json
// eval/results/<model>/<task>.jsonl（run.ts の出力）を全モデル × 全タスクで集計する。指標は test 160 件。
// 温度 T: 本線は「モデル毎に全タスクの calib をプールして fit した単一 T (T_pool)」、タスク別 T (T_task) は参考。
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { T_GRID_OLD, calibTByType, evaluatePooled, fitTemperature, scaleProbs, evalBlock, evaluateTask, mean, poolCalibT, type PooledEval, type Rec, type TaskEval } from "./metrics";
import { judge, TASKS as GATE_TASKS, THRESH, type Judgement } from "./gates";

const ROOT = resolve(import.meta.dir, "..");
const dir = resolve(process.argv[2] ?? join(ROOT, "eval/results"));
const TASK_DIR = join(ROOT, "data/tasks");
const allTaskNames = readdirSync(TASK_DIR).filter((f) => f.endsWith(".meta.json")).map((f) => f.replace(/\.meta\.json$/, "")).sort();
const metas: Record<string, any> = Object.fromEntries(allTaskNames.map((t) => [t, JSON.parse(readFileSync(join(TASK_DIR, `${t}.meta.json`), "utf8"))]));
const tasks = allTaskNames.filter((t) => !metas[t].exploratory); // 本線（事前登録）タスク
const explTasks = allTaskNames.filter((t) => metas[t].exploratory); // 探索的（事前登録外・gates/プール較正の対象外）
const Kof = (m: any) => (m.type === "noul" ? 2 : m.type === "score" ? m.levels : m.options.length);
const promptsHash = (d: string) => (existsSync(join(ROOT, d, "prompts.ts")) ? createHash("sha256").update(readFileSync(join(ROOT, d, "prompts.ts"))).digest("hex") : null);
const curPrompts = promptsHash("server");

const models = readdirSync(dir).filter((m) => statSync(join(dir, m)).isDirectory()).sort();
const evals: Record<string, Record<string, TaskEval>> = {};
const pooled: Record<string, PooledEval | null> = {};
const runInfo: Record<string, any> = {};
const judged: Record<string, Judgement> = {};
const judged5: Record<string, { j: Judgement; pooled: PooledEval | null; T: number }> = {}; // 補足（事前登録外）: sst5 を除く 5 タスクでの判定
const gridDiff: Record<string, { T_old: number; ece_old: number; T_new: number; ece_new: number; pooled_nll_old: number; pooled_nll_new: number }> = {};
const bench: Record<string, any> = {};
const serverModels: Record<string, Set<string>> = {};
for (const m of models) {
  const recsByTask: Record<string, Rec[]> = {};
  for (const t of allTaskNames) {
    const f = join(dir, m, `${t}.jsonl`);
    if (!existsSync(f)) continue;
    const byId = new Map<string, Rec>();
    for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) { const r = JSON.parse(l); byId.set(r.id, r); } // 後勝ち（エラー再試行の成功が残る）
    recsByTask[t] = [...byId.values()];
    for (const r of recsByTask[t]) if (r.server_model) (serverModels[m] ??= new Set()).add(r.server_model);
  }
  const lists = tasks.filter((t) => recsByTask[t]).map((t) => recsByTask[t]); // 探索的タスクは T の fit・プール評価から除外
  const { T, n_calib, ci: T_ci } = poolCalibT(lists);
  const TT = calibTByType(lists);
  { // 旧 grid（0.25–5.0）との差分（プール単一 T と、その T でのプール test ECE）
    const okr = lists.flatMap((rs) => rs.filter((r) => r.probs && r.format_ok));
    const c = okr.filter((r) => r.split === "calib"), te = okr.filter((r) => r.split === "test");
    if (c.length && te.length) {
      const Told = fitTemperature(c.map((r) => r.probs!), c.map((r) => r.gold), T_GRID_OLD);
      const bo = evalBlock(te.map((r) => scaleProbs(r.probs!, Told)), te.map((r) => r.gold), "choice", 2), bn = evalBlock(te.map((r) => scaleProbs(r.probs!, T)), te.map((r) => r.gold), "choice", 2);
      gridDiff[m] = { T_old: Told, ece_old: bo.ece, T_new: T, ece_new: bn.ece, pooled_nll_old: bo.nll, pooled_nll_new: bn.nll };
    }
  }
  for (const t of Object.keys(recsByTask)) (evals[m] ??= {})[t] = evaluateTask(recsByTask[t], metas[t], t, Kof(metas[t]), T, TT[metas[t].type]?.T ?? 1);
  pooled[m] = evaluatePooled(lists, T, Object.fromEntries(Object.entries(TT).map(([k, v]) => [k, v.T])));
  if (pooled[m]) { pooled[m]!.n_calib = n_calib; pooled[m]!.T_pool_ci = T_ci; pooled[m]!.T_type = TT; }
  const ri = join(dir, m, "run_info.json");
  if (existsSync(ri)) runInfo[m] = JSON.parse(readFileSync(ri, "utf8"));
  const bf = join(dir, m, "latency_bench.json");
  if (existsSync(bf)) bench[m] = JSON.parse(readFileSync(bf, "utf8"));
  if (!/-rev$/.test(m)) { // 補足: sst5 を除く 5 タスク（calib をプールした単一 T・種別別 T も 5 タスクで再 fit）
    const keep = tasks.filter((t) => t !== "sst5" && recsByTask[t]);
    const l5 = keep.map((t) => recsByTask[t]);
    const p5 = poolCalibT(l5), tt5 = calibTByType(l5);
    const ev5: Record<string, TaskEval> = {};
    for (const t of keep) ev5[t] = evaluateTask(recsByTask[t], metas[t], t, Kof(metas[t]), p5.T, tt5[metas[t].type]?.T ?? 1);
    const pe5 = evaluatePooled(l5, p5.T, Object.fromEntries(Object.entries(tt5).map(([k, v]) => [k, v.T])));
    judged5[m] = { j: judge(ev5, pe5, bench[m] ?? null, GATE_TASKS.filter((t) => t !== "sst5")), pooled: pe5, T: p5.T };
  }
  if (!/-rev$/.test(m)) judged[m] = judge(evals[m] ?? {}, pooled[m] ?? null, bench[m] ?? null); // 逆順診断 run は判定対象外
}

// ---- Markdown ----
const nan = (x: any) => x === null || x === undefined || Number.isNaN(x);
const f3 = (x: number | null | undefined) => (nan(x) ? "–" : x!.toFixed(3));
const f2 = (x: number | null | undefined) => (nan(x) ? "–" : x!.toFixed(2));
const f0 = (x: number | null | undefined) => (nan(x) ? "–" : x!.toFixed(0));
const pct = (x: number | null | undefined) => (nan(x) ? "–" : (100 * x!).toFixed(1) + "%");
const pctCI = (x: number, ci?: [number, number]) => (ci ? `${pct(x)} [${(100 * ci[0]).toFixed(0)}–${(100 * ci[1]).toFixed(0)}]` : pct(x));
const f3CI = (x: number, ci?: [number, number]) => (ci ? `${f3(x)} [${f2(ci[0])}–${f2(ci[1])}]` : f3(x));

type Opts = { avg?: (e: TaskEval) => number | null | undefined; avgFmt?: (x: number) => string; baseline?: boolean; only?: (m: any) => boolean };
function table(title: string, note: string, cell: (e: TaskEval) => string, opts: Opts = {}) {
  const cols = tasks.filter((t) => (opts.only ? opts.only(metas[t]) : true));
  if (!cols.length) return "";
  let s = `### ${title}\n${note ? note + "\n" : ""}\n| model | ${cols.join(" | ")}${opts.avg ? " | mean" : ""} |\n|---|${cols.map(() => "---").join("|")}${opts.avg ? "|---" : ""}|\n`;
  if (opts.baseline) s += `| *majority baseline* | ${cols.map((t) => pct(metas[t].majority_baseline_test_acc)).join(" | ")}${opts.avg ? " | " + opts.avgFmt!(mean(cols.map((t) => metas[t].majority_baseline_test_acc))) : ""} |\n`;
  for (const m of models) {
    const row = cols.map((t) => { const e = evals[m]?.[t]; return e?.test ? cell(e) : "–"; });
    let av = "";
    if (opts.avg) {
      const vs = cols.map((t) => evals[m]?.[t]).filter((e): e is TaskEval => !!e?.test).map((e) => opts.avg!(e)).filter((x): x is number => typeof x === "number" && !Number.isNaN(x));
      av = " | " + (vs.length === cols.length ? opts.avgFmt!(mean(vs)) : vs.length ? opts.avgFmt!(mean(vs)) + `*(${vs.length}/${cols.length}タスク)*` : "–");
    }
    s += `| ${m} | ${row.join(" | ")}${av} |\n`;
  }
  return s + "\n";
}

let md = `# TypeSafeAI 評価サマリ\n\n生成: ${new Date().toISOString()} / モデル(run): ${models.join(", ") || "(なし)"}\n\n`;
md += `## 来歴（再現性）\n\n| run | server model | config | x_* 拡張 | prompts.ts sha256 | 現行 prompts.ts と一致 | reverse-options | 開始 |\n|---|---|---|---|---|---|---|---|\n`;
for (const m of models) {
  const ri = runInfo[m];
  const cur = promptsHash(ri?.server_dir ?? "server");
  md += `| ${m} | ${[...(serverModels[m] ?? [])].join(" + ") || "(不明)"} | ${ri?.config ?? "v1"} | ${ri?.ext && Object.keys(ri.ext).length ? JSON.stringify(ri.ext) : "–"} | ${ri?.prompts_sha256 ? String(ri.prompts_sha256).slice(0, 12) : "(未記録)"} | ${ri?.prompts_sha256 ? (ri.prompts_sha256 === cur ? "はい" : "**いいえ（現行ファイルと別版）**") : "–"} | ${ri?.reverse_options ? "はい" : "いいえ"} | ${ri?.first_started_at ?? "–"} |\n`;
}
for (const m of models) if (runInfo[m]?.provenance_note) md += `\n注記（${m}）: ${runInfo[m].provenance_note}\n`;
md += `\nserver model が複数並ぶ行は run 中のモデル差し替え混在（要注意）。\n\n`;
md += `## 合否判定（docs/criteria.md 事前登録: A=素で全ゲート通過 / B=較正のみ単一 T 後に通過 / C=不可）\n\n`;
{
  const mark = (g: { pass: boolean | null }) => (g.pass === null ? "?" : g.pass ? "OK" : "NG");
  md += `| run (構成) | G1 形式 | G2 精度 | G3 較正 (A: 素) | G3 較正 (B: 単一T) | G4 選択的精度 | G5 レイテンシ | **判定** |\n|---|---|---|---|---|---|---|---|\n`;
  for (const m of models) { const j = judged[m]; if (!j) continue; md += `| ${m} (${runInfo[m]?.config ?? "v1"}) | ${mark(j.g1)} | ${mark(j.g2)} | ${mark(j.g3_raw)} | ${mark(j.g3_T)} | ${mark(j.g4)} | ${mark(j.g5)} | **${j.verdict}** |\n`; }
  md += `\n閾値（criteria.md 原文）: 形式 mass 平均≥${THRESH.mass_mean}・違反<${100 * THRESH.format_violation_rate}%・エラー0 / 精度 ${Object.entries(THRESH.acc).map(([k, v]) => `${k}≥${v}`).join(", ")}、sst5 は off-by-one≥${THRESH.sst5_off_by_one} も / 較正 プール ECE≤${THRESH.ece_pooled}、タスク別 CI 上限≤${THRESH.ece_task_ci_upper} / 選択的精度 cov@prec95 ${Object.entries(THRESH.cov95).map(([k, v]) => `${k}≥${v}`).join(", ")}、AUROC≥${THRESH.auroc}（各タスク）/ レイテンシ 1 質問 warm p50≤${THRESH.lat_1q_warm_p50_ms}ms・3 質問 warm p50≤${THRESH.lat_3q_warm_p50_ms}ms（構成そのもので測定。v2 は順序平均込み。bench の state は約 630 文字 ≒ 150〜200 トークンで、criteria の「約 300 トークン」より短い点に注意）。\n\n`;
  md += `G4 は A 列＝素の確率、B の判定には較正後の cov@prec95 を使う。AUROC は各タスクで判定（criteria.md に「各タスク」の明記なし。タスク別が妥当と解釈）。\n\n`;
  
md += `### 補足（**事前登録外**）: sst5 を除く 5 タスク（choice/noul 用途）での判定\n\nsst5 は score（5 段階）で、数字ラベル方式の弱さ・細粒度タスクの難しさが他と性質が違う。choice/noul 用途の可否を見るため、sst5 を除いた 5 タスク（boolq、marc、ag_news、banking、massive）で同じゲート（閾値は criteria.md のまま）を再判定した。単一 T・種別別 T・プール test（800 件）も 5 タスクで再 fit。本線の判定（上表）は変更しない。\n\n| run (構成) | G1 | G2 | G3 (A: 素) | G3 (B: 単一T) | G4 | G5 | **判定(5 タスク)** | プール acc | プール ECE 素 / 単一T | 不通過 |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
for (const m of models) {
  const x = judged5[m]; if (!x) continue;
  const j = x.j, p = x.pooled, mk = (g: { pass: boolean | null }) => (g.pass === null ? "?" : g.pass ? "OK" : "NG");
  const ng = [["G1", j.g1], ["G2", j.g2], ["G3(素)", j.g3_raw], ["G3(単一T)", j.g3_T], ["G4", j.g4], ["G5", j.g5]].filter(([, g]) => (g as any).pass === false).map(([n, g]) => `${n}: ${(g as any).fails.slice(0, 3).join("; ")}`).join(" / ");
  md += `| ${m} (${runInfo[m]?.config ?? "v1"}) | ${mk(j.g1)} | ${mk(j.g2)} | ${mk(j.g3_raw)} | ${mk(j.g3_T)} | ${mk(j.g4)} | ${mk(j.g5)} | **${j.verdict}** | ${p ? pct(p.raw.accuracy) : "–"} | ${p ? `${f3(p.raw.ece)} / ${f3(p.pooled_T.ece)} (T=${x.T})` : "–"} | ${ng || "–"} |\n`;
}
md += `\nG5 は測定値どおり（5 タスクでも変わらない）。\n\n`;
md += `### ゲート不通過の内訳\n\n`;
  for (const m of models) {
    const j = judged[m]; if (!j) continue;
    const rows: [string, string[]][] = [["G1", j.g1.fails], ["G2", j.g2.fails], ["G3(素)", j.g3_raw.fails], ["G3(単一T)", j.g3_T.fails], ["G4", j.g4.fails], ["G5", j.g5.fails]];
    md += `**${m}**: ${j.verdict}${j.missing.length ? `（欠損: ${j.missing.join(", ")}）` : ""}\n\n`;
    for (const [g, fl] of rows) if (fl.length) md += `- ${g}: ${fl.join(" / ")}\n`;
    md += "\n";
  }
}

md += `## 読み方\n\n`;
md += `- 指標はすべて **test 160 件/タスク**（calib 40 件は温度 T の fit にのみ使用）。\`[a–b]\` は test アイテムの bootstrap 95% CI（1000 回、seed 固定）。\n`;
md += `- ECE: **10 等幅 bin**・top-label confidence（等質量 10 bin 版も併記）。Brier: 多クラス Σ_k(p_k−y_k)²（0〜2）。NLL: nat。confidence = 確率の最大値（サーバの confidence 式ではなく確率から再計算）。\n`;
md += `- 温度 T の grid: **0.10〜5.00（0.05 刻み）＋5.5〜20（粗い刻み）**。旧 grid（0.25〜5.00）は上限 5.0 が実装上の制約で、T>5 を要するモデル（gemma）で頭打ちだったため 2026-10-07 に拡張し、全モデルを保存確率から再計算した（下表に旧 grid との差分）。\n- 温度スケーリング: **本線 = プール T（T_pool）**＝そのモデルの全タスクの calib をプールした単一 T を全タスクの test に適用。タスク別 T（T_task, 各 calib 40 件）は参考。\n`;
md += `- エラー（HTTP 失敗）と形式違反（確率の長さ/合計が不正）は指標から除外し、件数を別表に出す。多数派ベースライン = test の最頻クラス比率。\n`;
md += `- **レイテンシ**: 精度評価は並列（--concurrency）で走り、llama-server が直列なのでキュー待ちが混ざる。アイテム単位のレイテンシは指標として使わない。レイテンシは \`--latency-bench\`（concurrency 1・他負荷なし想定）の値のみ採用。\n\n`;

md += `## タスク\n\n| task | type | lang | K | question | source |\n|---|---|---|---|---|---|\n` + tasks.map((t) => { const m = metas[t]; return `| ${t} | ${m.type} | ${m.language} | ${Kof(m)} | ${String(m.question).slice(0, 60)} | ${String(m.source).split(",")[0].split(" (")[0]} |`; }).join("\n") + "\n\n";

md += `## 全タスクプール（モデル単位）\n\n`;
md += `| model | タスク数 | calib (T fit) | test | T_pool | accuracy | ECE raw [CI] | ECE pooled-T [CI] | ECE(等質量) raw → pooled-T | Brier raw → pooled-T | NLL raw → pooled-T | AUROC |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
for (const m of models) {
  const p = pooled[m];
  if (!p) { md += `| ${m} | – |\n`; continue; }
  md += `| ${m} | ${p.n_tasks} | ${p.n_calib} | ${p.n_test} | ${p.T_pool} | ${pctCI(p.raw.accuracy, p.raw.ci?.accuracy)} | ${f3CI(p.raw.ece, p.raw.ci?.ece)} | ${f3CI(p.pooled_T.ece, p.pooled_T.ci?.ece)} | ${f3(p.raw.ece_mass)} → ${f3(p.pooled_T.ece_mass)} | ${f3(p.raw.brier)} → ${f3(p.pooled_T.brier)} | ${f3(p.raw.nll)} → ${f3(p.pooled_T.nll)} | ${f3(p.raw.auroc)} |\n`;
}
md += `\n（プールは K の異なるタスクを混ぜた item 単位の集計。タスク難易度の違いが混ざるので、モデル間の相対比較用）\n\n`;

md += `## 精度\n\n`;
md += table("Accuracy [95% CI]", "", (e) => pctCI(e.test!.accuracy, e.test!.ci?.accuracy), { avg: (e) => e.test!.accuracy, avgFmt: pct, baseline: true });
md += table("Macro-F1", "gold か pred に現れたクラスの平均", (e) => f3(e.test!.macro_f1), { avg: (e) => e.test!.macro_f1, avgFmt: f3 });
md += table("Score タスク追加指標", "MAE(期待値) / MAE(argmax) / off-by-one 許容 accuracy。level は 1 始まり", (e) => `${f3(e.test!.score?.mae_expected)} / ${f3(e.test!.score?.mae_argmax)} / ${pct(e.test!.score?.acc_off_by_one)}`, { only: (m) => m.type === "score" });

md += `## 較正（A: 素 / B: 単一 T＝本線 / 補足: 種別別 T＝事前登録外）\n\n`;
md += `### 旧 grid（0.25–5.0）→ 新 grid（0.10–20）の差分（プール単一 T）\n\n| run | T_pool 旧 → 新 | プール ECE（単一 T 後）旧 → 新 | プール NLL 旧 → 新 |\n|---|---|---|---|\n`;
for (const m of models) { const d = gridDiff[m]; if (d) md += `| ${m} | ${d.T_old} → ${d.T_new}${d.T_old !== d.T_new ? " **変化**" : ""} | ${f3(d.ece_old)} → ${f3(d.ece_new)} | ${f3(d.pooled_nll_old)} → ${f3(d.pooled_nll_new)} |\n`; }
md += "\n";
md += `### 温度 T（95% CI は calib アイテムの bootstrap 300 回）\n\n| model | T_pool（B・本線, calib 全タスク）[CI] | 種別別 T（補足）: noul / score / choice [CI] | タスク別 T（参考） |\n|---|---|---|---|\n`;
for (const m of models) {
  const p = pooled[m]; if (!p) continue;
  const tt = (k: string) => (p.T_type[k] ? `${p.T_type[k].T} [${f2(p.T_type[k].ci[0])}–${f2(p.T_type[k].ci[1])}] (n=${p.T_type[k].n_calib})` : "–");
  md += `| ${m} | ${p.T_pool} [${f2(p.T_pool_ci[0])}–${f2(p.T_pool_ci[1])}] (n=${p.n_calib}) | ${tt("noul")} / ${tt("score")} / ${tt("choice")} | ${tasks.map((t) => `${t}=${evals[m]?.[t]?.T_task ?? "–"}`).join(", ")} |\n`;
}
md += "\n";
const trio = (title: string, fmt: (b: any, w: boolean) => string, get: (e: TaskEval) => [any, any, any], getP: (p: PooledEval) => [any, any, any]) => {
  let t = `### ${title}\n\n| run | task | A: 素 | B: 単一 T | 補足: 種別別 T |\n|---|---|---|---|---|\n`;
  for (const m of models) {
    for (const k of tasks) { const e = evals[m]?.[k]; if (!e?.test) continue; const [a, b, c] = get(e); t += `| ${m} | ${k} | ${fmt(a, true)} | ${fmt(b, true)} | ${fmt(c, true)} |\n`; }
    const p = pooled[m]; if (p) { const [a, b, c] = getP(p); t += `| ${m} | **全タスクプール(${p.n_test})** | **${fmt(a, true)}** | **${fmt(b, true)}** | **${fmt(c, true)}** |\n`; }
  }
  return t + "\n";
};
md += trio("ECE（10 等幅 bin）[95% CI]", (b) => f3CI(b.ece, b.ci?.ece), (e) => [e.test, e.test_Tpool, e.test_Ttype], (p) => [p.raw, p.pooled_T, p.type_T]);
md += trio("ECE（等質量 10 bin）", (b) => f3(b.ece_mass), (e) => [e.test, e.test_Tpool, e.test_Ttype], (p) => [p.raw, p.pooled_T, p.type_T]);
md += trio("Brier", (b) => f3(b.brier), (e) => [e.test, e.test_Tpool, e.test_Ttype], (p) => [p.raw, p.pooled_T, p.type_T]);
md += trio("NLL", (b) => f3(b.nll), (e) => [e.test, e.test_Tpool, e.test_Ttype], (p) => [p.raw, p.pooled_T, p.type_T]);
md += table("ECE task-T（参考・上限的な値）", "各タスクの calib 40 件で fit した T", (e) => `${f3(e.test_Ttask!.ece)} (T=${e.T_task})`, { avg: (e) => e.test_Ttask!.ece, avgFmt: f3 });
md += table("AUROC (confidence が正解を判別)", "0.5 = 無情報。T スケーリングは順位を変えないので生のみ", (e) => f3(e.test!.auroc), { avg: (e) => e.test!.auroc, avgFmt: f3 });

md += `## 選択的予測\n\n`;
md += table("confidence ≥ 0.9: coverage / precision", "raw → pooled-T（採用 0 件の precision は –）", (e) => `${pct(e.test!.cov_at_0_9)} / ${pct(e.test!.prec_at_0_9)} → ${pct(e.test_Tpool!.cov_at_0_9)} / ${pct(e.test_Tpool!.prec_at_0_9)}`);
md += table("precision ≥ 95% を満たす最大 coverage", "raw [95% CI] → pooled-T（conf 降順の全 prefix から最大を採用）", (e) => `${pctCI(e.test!.max_cov_at_prec_95, e.test!.ci?.max_cov_at_prec_95)} → ${pct(e.test_Tpool!.max_cov_at_prec_95)}`, { avg: (e) => e.test!.max_cov_at_prec_95, avgFmt: pct });

const hasOrders = models.filter((m) => tasks.some((t) => evals[m]?.[t]?.flip_rate !== null && evals[m]?.[t]?.flip_rate !== undefined));
if (hasOrders.length) {
  md += `## 順序平均（v2: x_permutations=2）の診断\n\n`;
  md += `flip rate = 2 つの提示順で argmax が食い違うアイテムの割合（choice/noul のみ。score は順序平均の対象外）。算術平均 = サーバが返す最終確率、対数平均 = x_debug.orders から再計算した幾何平均（再正規化）。\n\n| run | task | flip rate | 算術平均 acc / ECE / Brier / NLL | 対数平均 acc / ECE / Brier / NLL |\n|---|---|---|---|---|\n`;
  for (const m of hasOrders) for (const t of tasks) {
    const e = evals[m]?.[t]; if (!e?.test || e.flip_rate === null) continue;
    const q = (b: any) => (b ? `${pct(b.accuracy)} / ${f3(b.ece)} / ${f3(b.brier)} / ${f3(b.nll)}` : "–");
    md += `| ${m} | ${t} | ${pct(e.flip_rate)} | ${q(e.test)} | ${q(e.test_logmean)} |\n`;
  }
  md += "\n";
}

if (explTasks.length) {
  md += `## 探索的分析（**事前登録外**・gates とプール較正の対象外）\n\n`;
  md += `sst5 の派生タスク（同一アイテム・同一 split）を score 型 sst5（数字 0..4 提示・基準）と並べる。sst5_as_choice = 選択肢が 5 段階の記述ラベル・レター A-E 提示、sst5_perm2 = criteria 正順+逆順の 2 回提示をレベル順に戻して算術平均（ハーネス側）。差が大きければ「数字ラベル方式・位置バイアス」の問題、小さければモデル能力の問題。\n\n`;
  const pair = ["sst5", ...explTasks.filter((t) => t !== "sst5")];
  md += `| run | task | 提示方式 | accuracy [95% CI] | off-by-one | MAE(期待値) | ECE raw → pooled-T | 最多予測割合 (gold 最多) | 予測分布 (level1..5) | flip rate |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const m of models) for (const t of pair) {
    const e = evals[m]?.[t]; if (!e?.test) continue;
    md += `| ${m} | ${t} | ${t === "sst5" ? "score・数字 0..4（基準）" : metas[t].presentation ?? "?"} | ${pctCI(e.test.accuracy, e.test.ci?.accuracy)} | ${pct(e.test.score?.acc_off_by_one)} | ${f3(e.test.score?.mae_expected)} | ${f3(e.test.ece)} → ${f3(e.test_Tpool!.ece)} | ${pct(e.bias!.pred_max_share)} (${pct(e.bias!.gold_max_share)}) | ${e.bias!.pred_counts.join(", ")} | ${e.flip_rate === null ? "–" : pct(e.flip_rate)} |\n`;
  }
  md += "\n";
}

md += `## 形式遵守・信頼性\n\n`;
md += table("mass_on_labels 平均 / 最小", "ラベル集合に乗った確率質量（1 に近いほど形式遵守）", (e) => `${f3(e.mass_mean)} / ${f3(e.mass_min)}`);
md += table("エラー件数 / 形式違反率", "エラー = HTTP 失敗等（確率なし）、形式違反 = 確率の長さ・合計が不正。全アイテム（calib+test）に対する件数と率", (e) => `${e.n_err} / ${pct(e.n_format_violation / e.n_total)} (違反 ${e.n_format_violation}, 全 ${e.n_total})`);

const labelsOf = (m: any): string[] => (m.type === "noul" ? ["no", "yes"] : m.type === "score" ? Array.from({ length: m.levels }, (_, i) => String(i + 1)) : m.options);
md += `## 予測ラベル分布（位置バイアス検出）\n\n`;
md += table("TV 距離 / 最多予測クラスの割合 (gold の最多割合)", "TV = ½Σ|pred比率−gold比率|（0 で偏りなし）。位置バイアス（常に A を選ぶ等）があると TV と最多予測割合が大きくなる", (e) => `${f3(e.bias!.tv)} / ${pct(e.bias!.pred_max_share)} (${pct(e.bias!.gold_max_share)})`, { avg: (e) => e.bias?.tv, avgFmt: f3 });
for (const t of tasks) {
  const labs = labelsOf(metas[t]);
  const have = models.filter((m) => evals[m]?.[t]?.bias);
  if (!have.length) continue;
  md += `### ${t} の予測分布（test、クラス index 順の件数）\n\nクラス: ${labs.map((l, i) => `${i}=${l}`).join(" / ")}${runInfo[have.find((m) => runInfo[m]?.reverse_options) ?? ""] ? "\n\n（*-rev の run は選択肢を逆順提示。件数・index は元の順に戻して記録）" : ""}\n\n| | counts | 主な誤り (gold→pred ×件数) |\n|---|---|---|\n| **gold** | ${evals[have[0]][t].bias!.gold_counts.join(", ")} | |\n`;
  for (const m of have) { const b = evals[m][t].bias!; md += `| ${m} | ${b.pred_counts.join(", ")} | ${b.top_confusions.map((c) => `${c.gold}→${c.pred}×${c.n}`).join(", ") || "–"} |\n`; }
  md += "\n";
}

if (Object.keys(bench).length) {
  md += `## レイテンシ bench（1 state × 3 質問: noul + choice + score 同時、ms、concurrency 1）\n\n**レイテンシの唯一の採用値。** 他負荷（別エージェントの API 呼び出し等）が重なると値が悪化するので、解釈時は実行時の負荷に注意。\n\n| model | 3Q same-state warm p50 / p90 | 3Q vary-state cold p50 / p90 | noul-only warm p50 / p90 | passage chars |\n|---|---|---|---|---|\n`;
  const c = (x: any) => (x ? `${f0(x.client_ms.p50)} / ${f0(x.client_ms.p90)}` : "–");
  for (const m of models) if (bench[m]) md += `| ${m} | ${c(bench[m].three_questions_same_state_warm)} | ${c(bench[m].three_questions_vary_state_cold)} | ${c(bench[m].noul_only_same_state_warm)} | ${bench[m].passage_chars} |\n`;
  md += "\n";
}
writeFileSync(join(dir, "SUMMARY.md"), md);
writeFileSync(join(dir, "summary.json"), JSON.stringify({ generated_at: new Date().toISOString(), current_prompts_sha256: curPrompts, tasks: metas, run_info: runInfo, judged, judged_5tasks_no_sst5: Object.fromEntries(Object.entries(judged5).map(([k, v]) => [k, { verdict: v.j.verdict, T: v.T, gates: { g1: v.j.g1, g2: v.j.g2, g3_raw: v.j.g3_raw, g3_T: v.j.g3_T, g4: v.j.g4, g5: v.j.g5 }, pooled: v.pooled }])), pooled, grid_diff: gridDiff, evals, latency_bench: bench }, null, 2));
console.log(`wrote ${join(dir, "SUMMARY.md")} and summary.json (${models.length} runs, ${tasks.length} tasks)`);
