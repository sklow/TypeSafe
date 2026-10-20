// results/grades.jsonl（{model, cond, id, correct}）と results/<model>/<cond>.jsonl を突き合わせて RESULTS.md を作る
// p_supported を「回答が正しい確率」とみなして AUROC / ECE / 閾値採用を評価する。全 split をプール（問題数が少ないため）
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { auroc, ece, maxCoverageAtPrecision, mean, percentile } from "../../eval/metrics";
import { CONDS } from "./pipeline";

const R = resolve(import.meta.dir, "results");
const gp = join(R, "grades.jsonl");
if (!existsSync(gp)) { console.error("results/grades.jsonl がまだ無い"); process.exit(1); }
const read = (p: string): any[] => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const grades = new Map<string, boolean>(); for (const g of read(gp)) grades.set(`${g.model}|${g.cond}|${g.id}`, !!g.correct);
const pct = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? "–" : (100 * x).toFixed(1) + "%");
const f3 = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? "–" : x.toFixed(3));
const NAME: Record<string, string> = { rag_rag: "(a) 資料あり生成 + 資料あり検証", none_rag: "(b) 資料なし生成 + 資料あり検証", rag_none: "(c) 資料あり生成 + 資料なし検証" };
const models = readdirSync(R).filter((m) => statSync(join(R, m)).isDirectory() && !m.startsWith("dummy") && CONDS.some((c) => existsSync(join(R, m, `${c}.jsonl`))));
let md = `# 自由記述 QA: 生成 → Jev 検証 の結果\n\n生成: ${new Date().toISOString()}\n\n- 生成: llama-server（thinking 無効・temperature 0・max_tokens 128）。資料ありは hybrid 検索の上位 3 チャンクのみ根拠、資料なしは自身の知識で回答。\n- 検証: Jev 型 noul（v2 構成: letter/perms2）で p_supported = P(「回答は参考資料に裏付けられ、質問に正しく答えている」)。\n- 採点ラベルは別担当。回答正解率・AUROC・ECE（p_supported を正解確率とみなす、10 等幅 bin）・閾値採用は **全 split をプール**（問題数が少ない）。\n\n`;
const summary: any = {};
for (const m of models) {
  summary[m] = {};
  md += `## ${m}\n\n| 条件 | n(採点済) | 回答正解率 | AUROC | ECE | cov@prec95 | 採用率/採用分正解率 (≥0.5) | (≥0.8) | (≥0.9) | 生成 p50/p90 ms | 検証 p50/p90 ms |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const c of CONDS) {
    const rs = read(join(R, m, `${c}.jsonl`)).filter((r) => !r.error && r.p_supported !== null && grades.has(`${m}|${c}|${r.id}`)).map((r) => ({ ...r, correct: grades.get(`${m}|${c}|${r.id}`)! }));
    if (!rs.length) continue;
    const p = rs.map((r) => r.p_supported), ok = rs.map((r) => r.correct);
    const thr = [0.5, 0.8, 0.9].map((t) => { const x = rs.filter((r) => r.p_supported >= t); return { t, adopt: x.length / rs.length, prec: x.length ? mean(x.map((r) => (r.correct ? 1 : 0))) : null, n: x.length }; });
    const o = { n: rs.length, acc: mean(ok.map((x) => (x ? 1 : 0))), auroc: auroc(p, ok), ece: ece(p, ok), cov95: maxCoverageAtPrecision(p, ok, 0.95), thr, lat_gen: percentile(rs.map((r) => r.latency_gen), 0.5), lat_ver: percentile(rs.map((r) => r.latency_verify), 0.5) };
    summary[m][c] = o;
    md += `| ${NAME[c]} | ${o.n} | ${pct(o.acc)} | ${f3(o.auroc)} | ${f3(o.ece)} | ${pct(o.cov95)} | ${thr.map((x) => `${pct(x.adopt)} / ${pct(x.prec)} (n=${x.n})`).join(" | ")} | ${percentile(rs.map((r) => r.latency_gen), 0.5).toFixed(0)}/${percentile(rs.map((r) => r.latency_gen), 0.9).toFixed(0)} | ${percentile(rs.map((r) => r.latency_verify), 0.5).toFixed(0)}/${percentile(rs.map((r) => r.latency_verify), 0.9).toFixed(0)} |\n`;
  }
  // 正誤別の p_supported 平均、検索 hit/miss 別の正解率（rag 生成）
  md += `\n`;
  for (const c of CONDS) {
    const rs = read(join(R, m, `${c}.jsonl`)).filter((r) => !r.error && grades.has(`${m}|${c}|${r.id}`)).map((r) => ({ ...r, correct: grades.get(`${m}|${c}|${r.id}`)! }));
    if (!rs.length) continue;
    const cor = rs.filter((r) => r.correct), wr = rs.filter((r) => !r.correct);
    const abst = rs.filter((r) => /資料からは不明|回答できません|分かりません|不明/.test(r.answer));
    md += `- ${NAME[c]}: 平均 p_supported は正解 ${f3(mean(cor.map((r) => r.p_supported)))}（${cor.length} 件）/ 誤答 ${f3(mean(wr.map((r) => r.p_supported)))}（${wr.length} 件）。「不明」系の回答 ${abst.length} 件（うち正解扱い ${abst.filter((r) => r.correct).length}）、そのうち p_supported≥0.5 は ${abst.filter((r) => r.p_supported >= 0.5).length} 件`;
    if (c !== "none_rag") { const h = rs.filter((r) => r.recall_hit === true), mi = rs.filter((r) => r.recall_hit === false); md += `。検索 hit 時の正解率 ${pct(mean(h.map((r) => (r.correct ? 1 : 0))))}（${h.length}）/ miss 時 ${pct(mean(mi.map((r) => (r.correct ? 1 : 0))))}（${mi.length}）`; }
    md += `\n`;
  }
  md += `\n`;
}
writeFileSync(resolve(import.meta.dir, "RESULTS.md"), md);
writeFileSync(join(R, "summary.json"), JSON.stringify(summary, null, 1));
console.log("wrote RESULTS.md", models);
