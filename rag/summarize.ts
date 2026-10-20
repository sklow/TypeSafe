// rag/results/<model>/results.jsonl -> rag/RESULTS.md, rag/results/summary.json
// 指標は test のみ。単一 T = その条件の calib（noul+choice プール）で fit し test に適用。eval/metrics.ts を再利用
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { evalBlock, fitTemperature, mean, percentile, scaleProbs, type Block } from "../eval/metrics";

const R = resolve(import.meta.dir, "results");
const models = readdirSync(R).filter((m) => statSync(join(R, m)).isDirectory() && existsSync(join(R, m, "results.jsonl")) && !m.startsWith("dummy")).sort();
const COND = ["none", "rag-k3", "rag-k5", "oracle"];
const pct = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? "–" : (100 * x).toFixed(1) + "%");
const f3 = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? "–" : x.toFixed(3));
const ci = (b: Block, k: "accuracy" | "ece") => (b.ci ? ` [${k === "accuracy" ? (100 * b.ci[k][0]).toFixed(0) + "–" + (100 * b.ci[k][1]).toFixed(0) : b.ci[k][0].toFixed(2) + "–" + b.ci[k][1].toFixed(2)}]` : "");
const summary: any = {};
const perModel: Record<string, any[]> = {};
let md = `# RAG 評価結果（修士論文を知識源）\n\n生成: ${new Date().toISOString()}\n\n指標は **test のみ**。T = 条件ごとに calib（noul+choice プール）で fit した単一温度を test に適用（calib が小さいと不安定）。CI は bootstrap 95%（1000 回）。\`oracle\` = evidence_quote を含むチャンクを直接投入。\n\n`;
for (const m of models) {
  const recs = readFileSync(join(R, m, "results.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const byKey = new Map<string, any>(); for (const r of recs) byKey.set(`${r.cond}|${r.id}`, r);
  const all = [...byKey.values()].filter((r) => r.probs && r.format_ok);
  summary[m] = {}; perModel[m] = all;
  md += `## ${m}\n\n| 条件 | n(test) | acc [CI] | choice acc | noul acc | ECE 素 [CI] | ECE T後 (T) | AUROC | cov@prec95 | mass 平均/最小 | lat p50/p90 (ms) | state 文字数 | 入力トークン最大(2 順序合算) |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const c of COND) {
    const rs = all.filter((r) => r.cond === c); if (!rs.length) continue;
    const te = rs.filter((r) => r.split === "test"), ca = rs.filter((r) => r.split === "calib");
    if (!te.length) continue;
    const T = fitTemperature(ca.map((r) => r.probs), ca.map((r) => r.gold));
    const P = te.map((r) => r.probs), G = te.map((r) => r.gold);
    const raw = evalBlock(P, G, "choice", 2, true), cal = evalBlock(P.map((p: number[]) => scaleProbs(p, T)), G, "choice", 2, true);
    const accOf = (ty: string) => { const x = te.filter((r) => r.type === ty); return x.length ? mean(x.map((r) => (r.pred === r.gold ? 1 : 0))) : NaN; };
    const lat = rs.map((r) => r.latency_ms), mass = rs.map((r) => r.mass_on_labels).filter((x: any) => typeof x === "number");
    const toks = rs.map((r) => r.input_tokens).filter((x: any) => typeof x === "number");
    summary[m][c] = { n_test: te.length, n_calib: ca.length, T, raw, cal, acc_choice: accOf("choice"), acc_noul: accOf("noul") };
    md += `| ${c} | ${te.length} | ${pct(raw.accuracy)}${ci(raw, "accuracy")} | ${pct(accOf("choice"))} | ${pct(accOf("noul"))} | ${f3(raw.ece)}${ci(raw, "ece")} | ${f3(cal.ece)} (T=${T}) | ${f3(raw.auroc)} | ${pct(raw.max_cov_at_prec_95)} | ${f3(mean(mass))}/${f3(Math.min(...mass))} | ${percentile(lat, 0.5).toFixed(0)}/${percentile(lat, 0.9).toFixed(0)} | ${mean(rs.map((r) => r.state_chars)).toFixed(0)} | ${toks.length ? Math.max(...toks) : "–"} |\n`;
  }
  { // 属性別（needs_thesis / difficulty）の test 正答率
    const keys: [string, (r: any) => string][] = [["needs_thesis", (r) => String(r.needs_thesis)], ["difficulty", (r) => String(r.difficulty)]];
    for (const [name, f] of keys) {
      const vals = [...new Set(all.map(f))].filter((v) => v !== "null").sort(); if (!vals.length) continue;
      md += `\n${name} 別の test 正答率（n）:\n\n| ${name} | ${COND.join(" | ")} |\n|---|${COND.map(() => "---").join("|")}|\n`;
      for (const v of vals) md += `| ${v} | ${COND.map((c) => { const x = all.filter((r) => r.cond === c && r.split === "test" && f(r) === v); return x.length ? `${pct(mean(x.map((r) => (r.pred === r.gold ? 1 : 0))))} (${x.length})` : "–"; }).join(" | ")} |\n`;
    }
  }
  // 検索 recall（rag 条件の記録から。質問ごと 1 回）
  const seen = new Map<string, any>(); for (const r of all) if (r.recall && Object.keys(r.recall).length && !seen.has(r.id)) seen.set(r.id, r);
  const rr = [...seen.values()]; const te = rr.filter((r) => r.split === "test");
  if (rr.length) {
    md += `\n検索 recall@k（evidence を含むチャンクが上位 k に入った率。全 ${rr.length} 問 / test ${te.length} 問）: ${[1, 3, 5, 10].map((k) => `@${k}=${pct(mean(rr.map((r) => (r.recall[`r@${k}`] ? 1 : 0))))}`).join("、")}。evidence_quote がチャンクに完全一致しなかった問題: ${rr.filter((r) => !r.evidence_found).length} 問。\n`;
    // 検索成否と正誤の関係（rag-k5）
    const k5 = all.filter((r) => r.cond === "rag-k5" && r.recall?.["r@5"] !== undefined);
    const hit = k5.filter((r) => r.recall["r@5"]), miss = k5.filter((r) => !r.recall["r@5"]);
    if (k5.length) md += `rag-k5 の正答率: 検索成功時 ${pct(mean(hit.map((r) => (r.pred === r.gold ? 1 : 0))))}（${hit.length} 問）/ 検索失敗時 ${pct(mean(miss.map((r) => (r.pred === r.gold ? 1 : 0))))}（${miss.length} 問）\n`;
  }
  md += "\n";
}

// ---- 追加分析（モデル横断）----
const accOf = (x: any[]) => (x.length ? mean(x.map((r) => (r.pred === r.gold ? 1 : 0))) : NaN);
const key = (r: any) => `${r.cond}|${r.id}`;
if (models.length) {
  // (2) closed-book 可解（none 条件で全モデルが正解）の除外
  const correctNone = models.map((m) => new Set(perModel[m].filter((r) => r.cond === "none" && r.pred === r.gold).map((r) => r.id)));
  const solvable = new Set<string>([...correctNone[0]].filter((id) => correctNone.every((s) => s.has(id))));
  const allIds = new Set(perModel[models[0]].map((r) => r.id));
  md += `## closed-book 可解問題を除いた比較\n\nnone 条件で **全モデル（${models.join(", ")}）が正解**した問題 = 資料なしでも解ける問題として分離。全 ${allIds.size} 問中 ${solvable.size} 問（${pct(solvable.size / allIds.size)}）。test のみで比較（n は test 内の問題数）。\n\n| モデル | 部分集合 | n(test) | ${COND.join(" | ")} |\n|---|---|---|${COND.map(() => "---").join("|")}|\n`;
  for (const m of models) for (const [label, f] of [["全問", () => true], ["closed-book 可解を除く", (r: any) => !solvable.has(r.id)], ["closed-book 可解のみ", (r: any) => solvable.has(r.id)]] as [string, (r: any) => boolean][]) {
    const n = new Set(perModel[m].filter((r) => r.split === "test" && r.cond === "none" && f(r)).map((r) => r.id)).size;
    md += `| ${m} | ${label} | ${n} | ${COND.map((c) => { const x = perModel[m].filter((r) => r.cond === c && r.split === "test" && f(r)); return x.length ? pct(accOf(x)) : "–"; }).join(" | ")} |\n`;
  }
  md += "\n";
  // (3) 検索失敗時の acc と confidence（過信の確認）。rag 条件、全 80 問（calib 含む。失敗が少ないため）
  md += `## 検索失敗時の振る舞い（過信の確認）\n\nrecall@k が外れた問題（evidence を含むチャンクが上位 k に入らなかった問題）と当たった問題で、acc と confidence（top 確率）を比較。全 split をプール（失敗が少数のため）。「誤答のうち conf≥0.9」は過信の指標。\n\n| モデル | 条件 | 検索 | n | acc | 平均 conf | 誤答のうち conf≥0.9 | 誤答数 |\n|---|---|---|---|---|---|---|---|\n`;
  for (const m of models) for (const c of ["rag-k3", "rag-k5"]) {
    const k = c.slice(5);
    for (const [label, hit] of [["当たり", true], ["外れ", false]] as [string, boolean][]) {
      const x = perModel[m].filter((r) => r.cond === c && r.recall?.[`r@${k}`] === hit);
      if (!x.length) continue;
      const wrong = x.filter((r) => r.pred !== r.gold);
      md += `| ${m} | ${c} | ${label} | ${x.length} | ${pct(accOf(x))} | ${f3(mean(x.map((r) => r.conf)))} | ${wrong.length ? pct(wrong.filter((r) => r.conf >= 0.9).length / wrong.length) : "–"} | ${wrong.length} |\n`;
    }
  }
  md += `\n外れた問題の個別（rag-k5）:\n\n| モデル | id | gold | pred | conf | 取得チャンク外れ |\n|---|---|---|---|---|---|\n`;
  for (const m of models) for (const r of perModel[m].filter((r) => r.cond === "rag-k5" && r.recall?.["r@5"] === false)) md += `| ${m} | ${r.id} | ${r.gold} | ${r.pred} | ${f3(r.conf)} | ${r.recall["r@10"] ? "top10 には有り" : "top10 にも無し"} |\n`;
  md += "\n";
  // choice / noul 別（全条件）と、レイテンシ（concurrency 1）
  md += `## 種別別 acc（test）\n\n| モデル | 種別 | ${COND.join(" | ")} |\n|---|---|${COND.map(() => "---").join("|")}|\n`;
  for (const m of models) for (const ty of ["choice", "noul"]) md += `| ${m} | ${ty} | ${COND.map((c) => { const x = perModel[m].filter((r) => r.cond === c && r.split === "test" && r.type === ty); return x.length ? `${pct(accOf(x))} (${x.length})` : "–"; }).join(" | ")} |\n`;
  md += "\n";
}
{ // レイテンシ（concurrency 1、10 問、各条件 1 回ずつ＝cold 寄り）
  const L = join(R, "lat"); const rows: string[] = [];
  if (existsSync(L)) for (const m of readdirSync(L).sort()) {
    const f = join(L, m, "results.jsonl"); if (!existsSync(f)) continue;
    const rs = readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.probs);
    rows.push(`| ${m} | ${COND.map((c) => { const x = rs.filter((r) => r.cond === c).map((r) => r.latency_ms); return x.length ? `${percentile(x, 0.5).toFixed(0)} / ${percentile(x, 0.9).toFixed(0)} (n=${x.length})` : "–"; }).join(" | ")} |`);
  }
  if (rows.length) md += `## レイテンシ（concurrency 1、10 問、各質問 1 回・同一 state の再利用なし、2 順序込み。p50 / p90 ms）\n\n| モデル | ${COND.join(" | ")} |\n|---|${COND.map(() => "---").join("|")}|\n${rows.join("\n")}\n\n精度評価側のレイテンシ列は concurrency 2 でキュー待ちが混ざるため参考外。\n`;
}
writeFileSync(resolve(import.meta.dir, "RESULTS.md"), md);
writeFileSync(join(R, "summary.json"), JSON.stringify(summary, null, 1));
console.log("wrote RESULTS.md", models);
