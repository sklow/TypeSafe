// results/grades.jsonl（1 行 1 回答: {cond, id, accuracy 0-3, coverage 0-4, n_errors, clarity 0-3, sentences:[{idx,label}]}）
// と results/<cond>.jsonl（p_ok 付き文）から RESULTS.md を作る
//  文ラベル: supported（論文に裏付けあり）/ unsupported（記載なしだが誤りでない一般論・推測）/ incorrect（論文と矛盾・事実誤り）
//  文単位 AUROC は p_ok が高いほど OK とみなし、(1) bad = incorrect (2) bad = incorrect+unsupported の 2 通り
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { auroc, mean, percentile } from "../../eval/metrics";

const D = import.meta.dir, R = join(D, "results");
const read = (p: string): any[] => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const grades = read(join(R, "grades.jsonl"));
if (!grades.length) { console.error("results/grades.jsonl がまだ無い"); process.exit(1); }
const qs = new Map(read(join(D, "questions.jsonl")).map((q) => [q.id, q]));
const pct = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? "–" : (100 * x).toFixed(1) + "%");
const f2 = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? "–" : x.toFixed(2));
const f3 = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? "–" : x.toFixed(3));
const fileOf = (c: string) => (c === "claude-rag" ? "claude-rag.checked.jsonl" : `${c}.jsonl`);
const conds = [...new Set(grades.map((g) => g.cond))];
const ORDER = ["9b-rag", "4b-rag", "claude-rag", "9b-none"]; conds.sort((a, b) => (ORDER.indexOf(a) + 99) % 99 - (ORDER.indexOf(b) + 99) % 99);

interface Sent { cond: string; id: string; idx: number; p_ok: number; label: string; check_ms: number }
const allSents: Sent[] = []; const perCond: Record<string, any> = {};
let md = `# 説明文の生成 + 1 文ずつ Jev チェック: 結果\n\n生成: ${new Date().toISOString()}\n\n- 回答単位（rubric）: accuracy 0-3、coverage（key_points を満たした数）、n_errors（事実誤り・論文と矛盾する記述の数）、clarity 0-3。\n- 文単位ラベル: supported（論文に裏付けあり）/ unsupported（記載なし・誤りとは言えない一般論や推測）/ incorrect（論文と矛盾・事実誤り）。\n- p_ok = Jev の noul「この文は参考資料に裏付けられ、誤りを含まないか」の P(yes)（参考資料 = 質問に対する hybrid 上位 5 チャンク。9b-none の文も同じ資料ありでチェック）。\n- 検証器は生成と同じモデル（9b-*/4b-*）。claude-rag は 9B が検証。\n\n## 回答単位のスコア\n\n| 条件 | n | accuracy (0-3) | coverage 平均（要点数） | coverage 率 | 誤り数/回答 | clarity (0-3) | 文数/回答 | 生成 p50 (s) |\n|---|---|---|---|---|---|---|---|---|\n`;
for (const c of conds) {
  const gs = grades.filter((g) => g.cond === c); const res = new Map(read(join(R, fileOf(c))).map((r) => [r.id, r]));
  const covRate = mean(gs.map((g) => g.coverage / Math.max(1, (qs.get(g.id)?.key_points ?? []).length || 4)));
  const lat = gs.map((g) => res.get(g.id)?.latency_gen).filter((x: any) => typeof x === "number");
  let nS = 0;
  for (const g of gs) { const r = res.get(g.id); if (!r) continue; for (const s of g.sentences ?? []) { const t = r.sentences.find((x: any) => x.idx === s.idx); if (t && typeof t.p_ok === "number") { allSents.push({ cond: c, id: g.id, idx: s.idx, p_ok: t.p_ok, label: s.label, check_ms: t.latency_check }); nS++; } } }
  perCond[c] = { n: gs.length, n_sent: nS };
  md += `| ${c} | ${gs.length} | ${f2(mean(gs.map((g) => g.accuracy)))} | ${f2(mean(gs.map((g) => g.coverage)))} | ${pct(covRate)} | ${f2(mean(gs.map((g) => g.n_errors)))} | ${f2(mean(gs.map((g) => g.clarity)))} | ${f2(nS / gs.length)} | ${lat.length ? (percentile(lat, 0.5) / 1000).toFixed(1) : "–"} |\n`;
}
md += `\n（coverage 率 = coverage / その問題の key_points 数。key_points 数が取れない場合は 4 で割る）\n\n## 文ラベルの内訳と p_ok\n\n| 条件 | 文数 | supported | unsupported | incorrect | 平均 p_ok: supported / unsupported / incorrect |\n|---|---|---|---|---|---|\n`;
const meanBy = (xs: Sent[], l: string) => { const y = xs.filter((s) => s.label === l); return y.length ? f3(mean(y.map((s) => s.p_ok))) : "–"; };
for (const c of [...conds, "(全条件)"]) {
  const xs = c === "(全条件)" ? allSents : allSents.filter((s) => s.cond === c); if (!xs.length) continue;
  const n = (l: string) => xs.filter((s) => s.label === l).length;
  md += `| ${c} | ${xs.length} | ${n("supported")} | ${n("unsupported")} | ${n("incorrect")} | ${meanBy(xs, "supported")} / ${meanBy(xs, "unsupported")} / ${meanBy(xs, "incorrect")} |\n`;
}
md += `\n## 文単位: p_ok は問題のある文を見分けられるか\n\n定義 (1): bad = incorrect（検出したいのは明確な誤り）。定義 (2): bad = incorrect + unsupported（資料に裏付けのない文すべて）。検出率 = bad のうち p_ok < 閾値 で警告された割合、誤警報率 = bad でない文のうち警告された割合。\n\n| 条件 | 定義 | 文数(bad) | AUROC | 閾値 0.5: 検出率 / 誤警報率 | 閾値 0.8: 検出率 / 誤警報率 |\n|---|---|---|---|---|---|\n`;
const summary: any = { per_cond: perCond, sentence: {} };
for (const c of [...conds, "(全条件)"]) {
  const xs = c === "(全条件)" ? allSents : allSents.filter((s) => s.cond === c); if (!xs.length) continue;
  for (const [name, isBad] of [["(1) incorrect", (s: Sent) => s.label === "incorrect"], ["(2) incorrect+unsupported", (s: Sent) => s.label !== "supported"]] as [string, (s: Sent) => boolean][]) {
    const bad = xs.filter(isBad), good = xs.filter((s) => !isBad(s));
    const au = auroc(xs.map((s) => s.p_ok), xs.map((s) => !isBad(s)));
    const cell = (t: number) => `${bad.length ? pct(bad.filter((s) => s.p_ok < t).length / bad.length) : "–"} / ${good.length ? pct(good.filter((s) => s.p_ok < t).length / good.length) : "–"}`;
    md += `| ${c} | ${name} | ${xs.length}(${bad.length}) | ${f3(au)} | ${cell(0.5)} | ${cell(0.8)} |\n`;
    summary.sentence[`${c}|${name}`] = { n: xs.length, n_bad: bad.length, auroc: au };
  }
}
const ck = allSents.map((s) => s.check_ms);
md += `\n## レイテンシ\n\n- 生成 p50: 上表。1 文チェック p50: ${ck.length ? (percentile(ck, 0.5) / 1000).toFixed(1) : "–"} 秒（p90 ${ck.length ? (percentile(ck, 0.9) / 1000).toFixed(1) : "–"} 秒、v2 構成の 2 順序込み・concurrency 1）。1 回答（約 5 文）のチェックは約 ${ck.length ? (5 * percentile(ck, 0.5) / 1000).toFixed(0) : "–"} 秒。\n\n注意: 文の数が少なく（特に incorrect）、AUROC の信頼区間は広い。条件間の差を断定しないこと。\n`;
writeFileSync(join(D, "RESULTS.md"), md);
writeFileSync(join(R, "summary.json"), JSON.stringify(summary, null, 1));
console.log("wrote RESULTS.md", conds);
