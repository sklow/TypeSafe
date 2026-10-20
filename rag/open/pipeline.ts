// 生成→Jev 検証の 2 段階パイプライン（UI からも import して使える関数群）
//  1. retrieveTop: hybrid 検索で上位 k チャンク
//  2. generateAnswer: llama-server /v1/chat/completions（thinking 無効・temperature 0・max_tokens 128）で短い回答
//  3. verify: Jev 型 /v1/systemone の noul で「回答が参考資料に裏付けられ、質問に正しく答えているか」→ p_supported
import { Client } from "../../eval/api";
import { retrieve, chunks, type Chunk } from "../retrieve";

export const LLAMA_URL = process.env.LLAMA_URL ?? "http://127.0.0.1:8081";
export const JEV_URL = process.env.JEV_URL ?? "http://localhost:8789";
const fmt = (c: Chunk) => `[${c.section} / p.${c.page}] ${c.text}`;
export const NO_REF = "（参考資料なし）";

export const GEN_SYSTEM = "あなたは修士論文の内容に基づいて質問に答えるアシスタントです。参考資料のみに基づいて簡潔に答えてください（1〜2文）。参考資料に答えが無ければ「資料からは不明」と答えてください。";
export const GEN_SYSTEM_NOREF = "あなたは物理学に詳しいアシスタントです。質問に、あなたの知識だけで簡潔に（1〜2文）答えてください。確信が持てなくても、最も可能性の高い具体的な答えを述べてください（「不明」とは答えない）。";
export const VERIFY_INSTRUCTION = "この回答は参考資料の記述に裏付けられており、質問に正しく答えているか。";

export async function retrieveTop(question: string, k = 3) {
  return (await retrieve(question, k, "hybrid")).map((r) => r.chunk);
}

export async function generateAnswer(question: string, refs: Chunk[] | null): Promise<{ answer: string; latency_ms: number }> {
  const ref = refs ? refs.map(fmt).join("\n\n") : NO_REF;
  const user = `参考資料:\n${ref}\n\n質問: ${question}\n\n回答:`;
  const t0 = performance.now();
  const r = await fetch(`${LLAMA_URL}/v1/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "local", messages: [{ role: "system", content: refs ? GEN_SYSTEM : GEN_SYSTEM_NOREF }, { role: "user", content: refs ? user : `質問: ${question}\n\n回答:` }], temperature: 0, max_tokens: 128, chat_template_kwargs: { enable_thinking: false } }),
  });
  if (!r.ok) throw new Error(`llama ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j: any = await r.json();
  return { answer: String(j.choices?.[0]?.message?.content ?? "").trim(), latency_ms: performance.now() - t0 };
}

const jev = new Client(JEV_URL, "systemone", 300_000, { x_noul_style: "letter", x_permutations: 2, x_heading: "document" }); // v2 構成
export async function verify(question: string, answer: string, refs: Chunk[] | null): Promise<{ p_supported: number | null; latency_ms: number; mass_on_labels: number | null; error?: string }> {
  const state = { 参考資料: refs ? refs.map(fmt) : [NO_REF], 質問: question, 回答: answer };
  const res = await jev.decide(state, [{ name: "q", type: "noul", question: VERIFY_INSTRUCTION }]);
  const r = res.answers.q;
  return { p_supported: r.probs ? r.probs[1] : null, latency_ms: res.latency_ms, mass_on_labels: r.mass_on_labels, ...(r.error ? { error: r.error } : {}) };
}

export type Cond = "rag_rag" | "none_rag" | "rag_none"; // 生成の資料_検証の資料
export const CONDS: Cond[] = ["rag_rag", "none_rag", "rag_none"];
export async function runOne(question: string, cond: Cond, k = 3, refs?: Chunk[]) {
  const retrieved = refs ?? (await retrieveTop(question, k));
  const [genRef, verRef] = cond === "rag_rag" ? [retrieved, retrieved] : cond === "none_rag" ? [null, retrieved] : [retrieved, null];
  const g = await generateAnswer(question, genRef);
  const v = await verify(question, g.answer, verRef);
  return { retrieved, answer: g.answer, latency_gen: g.latency_ms, ...v, latency_verify: v.latency_ms };
}
export { chunks };
