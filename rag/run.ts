// RAG 評価: 条件 none / rag-k3 / rag-k5 / oracle を /v1/systemone (v2, :8789) に投げる。
// 使い方: bun rag/run.ts --model <label> --api http://localhost:8789 [--questions rag/questions.jsonl] [--conditions none,rag-k3,rag-k5,oracle] --out rag/results/<label>/ [--concurrency 2] [--limit N] [--mode hybrid|dense|bm25]
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Client, type QSpec } from "../eval/api";
import { chunks, retrieve, type Mode } from "./retrieve";
import { goldChunkIds, goldIndex, type Question } from "./evidence";

const { values: a } = parseArgs({ options: {
  model: { type: "string" }, api: { type: "string", default: "http://localhost:8789" }, questions: { type: "string", default: resolve(import.meta.dir, "questions.jsonl") },
  conditions: { type: "string", default: "none,rag-k3,rag-k5,oracle" }, out: { type: "string" }, concurrency: { type: "string", default: "2" },
  limit: { type: "string" }, mode: { type: "string", default: "hybrid" }, config: { type: "string", default: "v2" },
  "x-noul-style": { type: "string", default: "letter" }, "x-permutations": { type: "string", default: "2" }, "x-heading": { type: "string", default: "document" },
} });
if (!a.model || !a.out) { console.error("usage: bun rag/run.ts --model <label> --out <dir> [--api ...] [--questions ...] [--conditions ...]"); process.exit(2); }
const out = resolve(a.out); mkdirSync(out, { recursive: true });
const ext = { x_noul_style: a["x-noul-style"], x_permutations: Number(a["x-permutations"]), x_heading: a["x-heading"] };
const client = new Client(a.api!, "systemone", 300_000, ext);
let qs: Question[] = readFileSync(resolve(a.questions!), "utf8").trim().split("\n").map((l) => JSON.parse(l));
if (a.limit) { const L = Number(a.limit); qs = [...qs.filter((q) => q.split === "calib").slice(0, Math.ceil(L / 2)), ...qs.filter((q) => q.split === "test").slice(0, Math.floor(L / 2))]; }
const conds = a.conditions!.split(",");
const NO_REF = "（参考資料なし）";
const fmt = (c: { id: string; section: string; page: number; text: string }) => `[${c.section} / p.${c.page}] ${c.text}`;

const file = join(out, "results.jsonl");
const readJsonl = (p: string): any[] => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const done = new Set(readJsonl(file).filter((r) => !r.error).map((r) => `${r.cond}|${r.id}`));
writeFileSync(join(out, "run_info.json"), JSON.stringify({ model: a.model, api: a.api, conditions: conds, mode: a.mode, ext, n_questions: qs.length, started_at: new Date().toISOString(), chunks: chunks.length }, null, 1));

const jobs = qs.flatMap((q) => conds.map((c) => ({ q, c }))).filter(({ q, c }) => !done.has(`${c}|${q.id}`));
console.log(`${qs.length} questions x ${conds.length} conditions, ${jobs.length} to run`);
let i = 0, n = 0;
const retCache = new Map<string, Awaited<ReturnType<typeof retrieve>>>();
async function work() {
  while (i < jobs.length) {
    const { q, c } = jobs[i++];
    const gold = goldIndex(q), gc = goldChunkIds(q);
    const query = q.question + (q.options ? " " + q.options.join(" ") : "");
    let ref: typeof chunks = [], recall: Record<string, boolean> = {};
    if (c.startsWith("rag-k") || c === "oracle") {
      if (!retCache.has(q.id)) retCache.set(q.id, await retrieve(query, 10, a.mode as Mode));
      const r = retCache.get(q.id)!;
      for (const k of [1, 3, 5, 10]) recall[`r@${k}`] = r.slice(0, k).some((x) => gc.ids.includes(x.chunk.id));
      if (c.startsWith("rag-k")) ref = r.slice(0, Number(c.slice(5))).map((x) => x.chunk);
      else ref = gc.ids.slice(0, 2).map((id) => chunks.find((x) => x.id === id)!);
    }
    const state = c === "none" ? NO_REF : { 参考資料: ref.map(fmt) };
    const spec: QSpec = q.type === "noul" ? { name: "q", type: "noul", question: q.question } : { name: "q", type: "choice", question: q.question, options: q.options };
    const res = await client.decide(state, [spec]);
    const r = res.answers.q;
    const stateChars = typeof state === "string" ? state.length : state.参考資料.join("").length;
    appendFileSync(file, JSON.stringify({
      id: q.id, cond: c, split: q.split, difficulty: (q as any).difficulty ?? null, needs_thesis: (q as any).needs_thesis ?? null, type: q.type, K: q.type === "noul" ? 2 : q.options!.length, gold, probs: r.probs, pred: r.pred, conf: r.conf,
      latency_ms: res.latency_ms, mass_on_labels: r.mass_on_labels, orders: r.orders, flip: r.flip, format_ok: r.format_ok, state_chars: stateChars,
      input_tokens: res.input_tokens ?? null, ref_ids: ref.map((x) => x.id), evidence_found: gc.found, gold_chunk_ids: gc.ids, recall, ...(r.error ? { error: r.error } : {}),
    }) + "\n");
    if (++n % 20 === 0 || n === jobs.length) console.log(`${n}/${jobs.length}`);
  }
}
await Promise.all(Array.from({ length: Number(a.concurrency) }, work));
console.log("done", file);
