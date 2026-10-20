// 使い方: bun rag/open/run.ts --model <label> [--questions rag/questions_open.jsonl] [--conds rag_rag,none_rag,rag_none] [--out rag/open/results/<label>/] [--limit N] [--concurrency 1]
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CONDS, runOne, type Cond } from "./pipeline";
import { goldChunkIds } from "../evidence";

const ROOT = resolve(import.meta.dir);
const { values: a } = parseArgs({ options: { model: { type: "string" }, questions: { type: "string", default: resolve(ROOT, "../questions_open.jsonl") }, conds: { type: "string", default: CONDS.join(",") }, out: { type: "string" }, limit: { type: "string" }, concurrency: { type: "string", default: "1" } } });
if (!a.model) { console.error("usage: bun rag/open/run.ts --model <label> [...]"); process.exit(2); }
const out = resolve(a.out ?? join(ROOT, "results", a.model)); mkdirSync(out, { recursive: true });
let qs: any[] = readFileSync(resolve(a.questions!), "utf8").trim().split("\n").map((l) => JSON.parse(l));
if (a.limit) { const L = Number(a.limit); qs = [...qs.filter((q) => q.split === "calib").slice(0, Math.ceil(L / 2)), ...qs.filter((q) => q.split !== "calib").slice(0, Math.floor(L / 2))]; }
const conds = a.conds!.split(",") as Cond[];
const read = (p: string): any[] => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const jobs: { q: any; c: Cond }[] = [];
for (const c of conds) { const done = new Set(read(join(out, `${c}.jsonl`)).filter((r) => !r.error).map((r) => r.id)); for (const q of qs) if (!done.has(q.id)) jobs.push({ q, c }); }
console.log(`${qs.length} questions x ${conds.length} conds, ${jobs.length} to run`);
let i = 0, n = 0;
async function work() {
  while (i < jobs.length) {
    const { q, c } = jobs[i++];
    const question: string = q.question_open ?? q.question;
    let rec: any;
    try {
      const r = await runOne(question, c);
      const gold = q.evidence_quote ? goldChunkIds(q).ids : q.evidence_chunk_ids ?? [];
      rec = { id: q.id, split: q.split, question, retrieved_ids: r.retrieved.map((x) => x.id), recall_hit: gold.length ? r.retrieved.some((x) => gold.includes(x.id)) : null, answer: r.answer, p_supported: r.p_supported, latency_gen: r.latency_gen, latency_verify: r.latency_verify, mass_on_labels: r.mass_on_labels, ...(r.error ? { error: r.error } : {}) };
    } catch (e: any) { rec = { id: q.id, split: q.split, question, error: String(e?.message ?? e) }; }
    appendFileSync(join(out, `${c}.jsonl`), JSON.stringify(rec) + "\n");
    if (++n % 10 === 0 || n === jobs.length) console.log(`${n}/${jobs.length}`);
  }
}
await Promise.all(Array.from({ length: Number(a.concurrency) }, work));
// to_grade.jsonl: results/ 配下の全モデル × 条件を answer と gold と並べて再生成
const R = resolve(ROOT, "results"), qAll = new Map<string, any>();
for (const q of read(resolve(a.questions!))) qAll.set(q.id, q);
const rows: any[] = [];
for (const m of readdirSync(R)) { const d = join(R, m); if (!statSync(d).isDirectory()) continue; for (const c of CONDS) for (const r of read(join(d, `${c}.jsonl`))) { if (r.error || r.answer === undefined) continue; const q = qAll.get(r.id) ?? {}; rows.push({ model: m, cond: c, id: r.id, question: r.question, gold_answer: q.gold_answer ?? null, acceptable: q.acceptable ?? null, answer: r.answer }); } }
writeFileSync(join(R, "to_grade.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log("done", out, "to_grade rows", rows.length);
