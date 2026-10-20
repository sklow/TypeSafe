// 使い方（処理はすべて再開可能）:
//   bun rag/explain/run.ts contexts                       questions.jsonl -> contexts.jsonl（上位 5 チャンク）
//   bun rag/explain/run.ts run --cond 9b-rag|9b-none|4b-rag   生成 → 文分割 → 1 文チェック（:8081 のモデルが条件に合うこと）
//   bun rag/explain/run.ts external --cond claude-rag     results/claude-rag.jsonl（{id, answer}）を文分割 → チェック（検証器は :8081 のモデル）
//   bun rag/explain/run.ts togr                           results/*.jsonl -> to_grade.jsonl（p_ok を含めない）
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { checkSentence, generateExplanation, retrieveTop, splitSentences, LLAMA_URL } from "./pipeline";
import { chunks } from "../retrieve";

const D = import.meta.dir, R = join(D, "results");
const { positionals, values: a } = parseArgs({ allowPositionals: true, options: { cond: { type: "string" }, questions: { type: "string", default: join(D, "questions.jsonl") }, limit: { type: "string" } } });
const read = (p: string): any[] => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const qsAll = () => { let q = read(resolve(a.questions!)); if (a.limit) q = q.slice(0, Number(a.limit)); return q; };
const byId = (c: string) => new Map(chunks.map((x) => [x.id, x]).concat([] as any)) as Map<string, any>;
const cmd = positionals[0];

async function loadedModel(): Promise<string> { const j: any = await (await fetch(`${LLAMA_URL}/v1/models`)).json(); return String(j.models?.[0]?.name ?? j.data?.[0]?.id ?? ""); }

if (cmd === "contexts") {
  const f = join(D, "contexts.jsonl"); const have = new Set(read(f).map((r) => r.id));
  for (const q of qsAll()) if (!have.has(q.id)) { const refs = await retrieveTop(q.question, 5); appendFileSync(f, JSON.stringify({ id: q.id, chunk_ids: refs.map((c) => c.id), texts: refs.map((c) => c.text) }) + "\n"); }
  console.log("contexts:", read(f).length);
} else if (cmd === "run" || cmd === "external") {
  const cond = a.cond!; const ctxs = new Map(read(join(D, "contexts.jsonl")).map((r) => [r.id, r]));
  const model = await loadedModel(); const mname = /9B/i.test(model) ? "9b" : /4B/i.test(model) ? "4b" : model;
  if (cmd === "run" && !cond.startsWith(mname)) { console.error(`条件 ${cond} には :8081 に ${cond.slice(0, 2)} 系モデルが必要（現在 ${model}）`); process.exit(3); }
  const file = join(R, `${cond}.jsonl`); const done = new Set(read(file).filter((r) => r.checked).map((r) => r.id));
  const qs = qsAll(); const ext = cmd === "external" ? new Map(read(file).filter((r) => !r.checked || r.answer).map((r) => [r.id, r])) : null;
  // external: results/claude-rag.jsonl の {id, answer} 行を元入力とし、チェック済みの結果は別ファイルに書く
  const outFile = cmd === "external" ? join(R, `${cond}.checked.jsonl`) : file;
  const doneOut = new Set(read(outFile).filter((r) => r.checked).map((r) => r.id));
  for (const q of qs) {
    if (doneOut.has(q.id)) continue;
    const ctx = ctxs.get(q.id); if (!ctx) { console.error("contexts 未作成:", q.id); continue; }
    const refs = ctx.chunk_ids.map((id: string) => chunks.find((c) => c.id === id)!);
    let answer: string, latency_gen: number | null = null;
    if (cmd === "run") { const g = await generateExplanation(q.question, cond.endsWith("none") ? null : refs); answer = g.answer; latency_gen = g.latency_ms; }
    else { const e = ext!.get(q.id); if (!e?.answer) continue; answer = e.answer; }
    const sentences = [] as any[]; let i = 0;
    for (const t of splitSentences(answer)) { const c = await checkSentence(t, refs); sentences.push({ idx: i++, text: t, p_ok: c.p_ok, latency_check: c.latency_ms, ...(c.error ? { error: c.error } : {}) }); }
    appendFileSync(outFile, JSON.stringify({ id: q.id, cond, answer, sentences, latency_gen, checker: mname, checked: true }) + "\n");
    console.log(cond, q.id, sentences.length, "文");
  }
  console.log("done", outFile);
} else if (cmd === "togr") {
  const qm = new Map(read(a.questions!).map((q) => [q.id, q])); const rows: any[] = [];
  for (const f of readdirSync(R).sort()) {
    if (!f.endsWith(".jsonl") || f === "to_grade.jsonl" || f === "grades.jsonl") continue;
    const cond = f.replace(/\.checked\.jsonl$|\.jsonl$/, ""); if (f === "claude-rag.jsonl" && existsSync(join(R, "claude-rag.checked.jsonl"))) continue; // 未チェックの元入力は checked 版を優先
    for (const r of read(join(R, f))) { if (!r.checked) continue; const q = qm.get(r.id) ?? {}; rows.push({ cond, id: r.id, question: q.question, key_points: q.key_points, common_errors: q.common_errors, reference_answer: q.reference_answer, answer: r.answer, sentences: r.sentences.map((s: any) => ({ idx: s.idx, text: s.text })) }); }
  }
  writeFileSync(join(R, "to_grade.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n"); console.log("to_grade rows", rows.length);
} else console.error("usage: contexts | run --cond ... | external --cond claude-rag | togr");
