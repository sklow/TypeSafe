// 修論 RAG Playground（port 8792）。検索(rag/retrieve.ts) → Jev(:8789 /v1/systemone) / 生成(:8081)。
// 選択式: /api/choice、自由記述: /api/open（rag/open/pipeline.ts）、結果: /api/summary /api/open-results
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { retrieve } from "../retrieve";

const PORT = Number(process.env.PORT ?? 8792);
const JEV = process.env.JEV_URL ?? "http://127.0.0.1:8789";
const LLAMA = process.env.LLAMA_URL ?? "http://127.0.0.1:8081";
const RAG = resolve(import.meta.dir, "..");
const fmt = (c: { section: string; page: number; text: string }) => `[${c.section} / p.${c.page}] ${c.text}`;
const NO_REF = "（参考資料なし）";

async function jev(state: unknown, questions: Record<string, unknown>) {
  const r = await fetch(`${JEV}/v1/systemone`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ state, questions }) });
  if (!r.ok) throw new Error(`jev ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as any;
}
const search = async (q: string, k: number) => (await retrieve(q, k, "hybrid")).map((x) => ({ id: x.chunk.id, section: x.chunk.section, page: x.chunk.page, score: x.score, text: x.chunk.text }));

async function choice(body: any) {
  const t0 = performance.now();
  const options: string[] = body.options;
  const chunks = await search(body.question + " " + options.join(" "), 3);
  const state = body.ref === false ? NO_REF : { 参考資料: chunks.map(fmt) };
  const j = await jev(state, { q: { type: "choice", instructions: body.question, criteria: Object.fromEntries(options.map((o) => [o, null])) } });
  const a = j.answers.q;
  return { chunks, answer: { choice: a.choice, probabilities: a.probabilities, confidence: a.confidence }, model: j.model, jev_ms: j.x_debug?.latency_ms, total_ms: Math.round(performance.now() - t0) };
}

// ---- 自由記述: rag/open/pipeline.ts（検索→生成→Jev noul 検証）を使う ----
async function open(body: any) {
  const t0 = performance.now();
  const { runOne, generateAnswer, verify, retrieveTop } = await import(join(RAG, "open/pipeline.ts"));
  const chunks = await search(body.question, 3);
  let answer: string, p: number | null, gen_ms: number, jev_ms: number;
  if (body.ref === false) {
    const g = await generateAnswer(body.question, null); const v = await verify(body.question, g.answer, null);
    answer = g.answer; p = v.p_supported; gen_ms = Math.round(g.latency_ms); jev_ms = Math.round(v.latency_ms);
  } else {
    const refs = await retrieveTop(body.question, 3);
    const r = await runOne(body.question, "rag_rag", 3, refs);
    answer = r.answer; p = r.p_supported; gen_ms = Math.round(r.latency_gen); jev_ms = Math.round(r.latency_verify);
  }
  return { chunks, answer, p_supported: p, model: "Qwen3.5-9B (llama.cpp Q4_K_M)", gen_ms, jev_ms, total_ms: Math.round(performance.now() - t0) };
}

// ---- 画像比較（vision） ----
const VIS = resolve(RAG, "../vision");
const VISION_URL = process.env.VISION_URL ?? "http://127.0.0.1:8793";
const GLANCE_URL = process.env.GLANCE_URL ?? "http://127.0.0.1:8078";
const readPairs = () => readFileSync(join(VIS, "pairs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const REL = ["same", "opposite", "unrelated"];
// VISION_CACHE=1: 同じ (組, エンジン) の結果を保持して再利用（録画で待ち時間を避けるため。応答に cached:true を付け、UI にも表示する）
const vcache = new Map<string, any>();
async function vision(body: any) {
  const engs: string[] = body.engine === "both" ? ["jev", "glance"] : [body.engine];
  if (process.env.VISION_CACHE === "1") {
    const hit = engs.map((e) => vcache.get(`${body.pair_id}|${e}`));
    if (hit.every(Boolean)) return { pair: hit[0].pair, engines: Object.fromEntries(engs.map((e, i) => [e, hit[i].engines[e]])), cached: true };
  }
  const r = await visionRun(body);
  if (process.env.VISION_CACHE === "1") for (const e of engs) if (r.engines[e] && !r.engines[e].error) vcache.set(`${body.pair_id}|${e}`, { pair: r.pair, engines: { [e]: r.engines[e] } });
  return r;
}
async function visionRun(body: any) {
  const p = readPairs().find((x: any) => x.id === body.pair_id); if (!p) throw new Error("unknown pair");
  const T = resolve(VIS, p.thesis_fig), O = resolve(VIS, p.other_fig);
  const sameQ = p.questions.find((q: any) => q.qid === "same_conclusion"), relQ = p.questions.find((q: any) => q.qid === "relation");
  const out: any = { pair: { id: p.id, relation: p.relation, claim: p.claim, gold_same: p.gold_same_conclusion, rel_gold: relQ?.options?.[relQ.gold] }, engines: {} };
  const engines: string[] = body.engine === "both" ? ["jev", "glance"] : [body.engine];
  await Promise.all(engines.map(async (eng) => {
    const t0 = performance.now();
    try {
      let j: any;
      if (eng === "jev") {
        const questions: any = { same: { type: "noul", instructions: sameQ.instructions } };
        if (relQ) questions.relation = { type: "choice", instructions: relQ.instructions, criteria: Object.fromEntries(relQ.options.map((o: string) => [o, null])) };
        const r = await fetch(`${VISION_URL}/v1/systemone`, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(300000),
          body: JSON.stringify({ state: `論文の主張: ${p.claim}\n図A（左の図）はこの主張を支える論文の図。図B（右の図）は別の出典の比較用の図。`, questions, x_images: [{ name: "図A（左の図・論文の図）", path: T }, { name: "図B（右の図・比較図）", path: O }] }) });
        j = await r.json(); if (!r.ok) throw new Error(j.error);
      } else {
        const refs = (t: string) => t.replace(/左の図（論文の図）|左の図/g, "論文の図（`img0`）").replace(/右の図/g, "比較図（`img1`）");
        const questions: any = { same: { type: "noul", instructions: refs(sameQ.instructions) } };
        if (relQ) questions.relation = { type: "choice", instructions: refs(relQ.instructions), criteria: Object.fromEntries(relQ.options.map((o: string) => [o, null])) };
        const r = await fetch(`${GLANCE_URL}/v1/decide`, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(300000),
          body: JSON.stringify({ model: "vlm", state: { images: [{ id: "img0", path: T }, { id: "img1", path: O }] }, questions, options: { choice_method: "independent", calibrated: false } }) });
        j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.status);
      }
      out.engines[eng] = { same: j.answers.same.noul, relation: j.answers.relation ? { choice: j.answers.relation.choice, probabilities: j.answers.relation.probabilities } : null, ms: Math.round(performance.now() - t0), model: j.model };
    } catch (e: any) { out.engines[eng] = { error: String(e.message ?? e) }; }
  }));
  return out;
}

const readJson = (p: string) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
Bun.serve({
  port: PORT, idleTimeout: 120,
  async fetch(req) {
    const u = new URL(req.url);
    const json = (x: unknown, s = 200) => Response.json(x, { status: s, headers: { "cache-control": "no-store" } });
    try {
      if (u.pathname === "/") return new Response(Bun.file(join(import.meta.dir, "index.html")), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
      if (u.pathname === "/api/presets") {
        const ids = ["q012", "q022", "q009", "q041", "q057", "q023"];
        const qs = readFileSync(join(RAG, "questions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
        const choice = ids.map((id) => qs.find((q: any) => q.id === id)).filter((q: any) => q && q.type === "choice").map((q: any) => ({ id: q.id, question: q.question, options: q.options, gold: q.gold, section: q.section }));
        return json({ choice });
      }
      if (u.pathname === "/api/pairs") return json(readPairs().filter((p: any) => p.split === "test").map((p: any) => ({ id: p.id, relation: p.relation, claim: p.claim, thesis_fig: p.thesis_fig, other_fig: p.other_fig, src: p.thesis_src })));
      if (u.pathname.startsWith("/fig/")) { const f = resolve(VIS, "figs", decodeURIComponent(u.pathname.slice(5))); if (!f.startsWith(join(VIS, "figs")) || !existsSync(f)) return json({ error: "no" }, 404); return new Response(Bun.file(f)); }
      if (u.pathname === "/api/vision-results") return json({ jev: readJson(join(VIS, "results/summary.json")), glance: readJson(join(VIS, "results/glance/summary.json")) });
      if (u.pathname === "/api/summary") return json(readJson(join(RAG, "results/summary.json")) ?? {});
      if (u.pathname === "/api/open-results") {
        const d = join(RAG, "open"); if (!existsSync(d)) return json({});
        const f = readdirSync(d).filter((x) => /^RESULTS.*\.json$/i.test(x)).sort();
        const md = readdirSync(d).filter((x) => /^RESULTS.*\.md$/i.test(x));
        return json({ json: f.length ? readJson(join(d, f[f.length - 1])) : null, md: md.length ? readFileSync(join(d, md[0]), "utf8").slice(0, 20000) : null });
      }
      if (req.method === "POST") {
        const body = await req.json();
        if (u.pathname === "/api/retrieve") return json({ chunks: await search(body.query, body.k ?? 3) });
        if (u.pathname === "/api/choice") return json(await choice(body));
        if (u.pathname === "/api/open") return json(await open(body));
        if (u.pathname === "/api/vision") return json(await vision(body));
      }
      return json({ error: "not found" }, 404);
    } catch (e: any) { return json({ error: String(e.message ?? e) }, 502); }
  },
});
console.log(`rag-ui on http://127.0.0.1:${PORT}`);
