// 説明文の生成 → 1 文ずつ Jev チェック（UI からも import 可）
import { Client } from "../../eval/api";
import { retrieve, type Chunk } from "../retrieve";

export const LLAMA_URL = process.env.LLAMA_URL ?? "http://127.0.0.1:8081";
export const JEV_URL = process.env.JEV_URL ?? "http://localhost:8789";
const fmt = (c: Chunk) => `[${c.section} / p.${c.page}] ${c.text}`;

export const SYS_RAG = "あなたは物理学の研究者です。参考資料に基づき、質問に日本語で4〜6文の分かりやすい説明を書いてください。資料に無いことは推測と明記してください。";
export const SYS_NONE = "あなたは物理学の研究者です。質問に日本語で4〜6文の分かりやすい説明を書いてください。論文の内容を知らなければ、一般的な知識で説明してください。";
export const CHECK_INSTRUCTION = "この文の内容は参考資料の記述に裏付けられており、誤りを含まないか。";

export async function retrieveTop(question: string, k = 5): Promise<Chunk[]> { return (await retrieve(question, k, "hybrid")).map((r) => r.chunk); }

/** 句点基準の文分割。改行・箇条書きも区切りとして扱い、先頭の記号（- * 1. 等）と ** を除く */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.replace(/\*\*/g, "").split(/\n+/)) {
    const l = line.replace(/^\s*(?:[-*・●■]|\d+[.)．）])\s*/, "").trim();
    if (!l) continue;
    for (const s of l.split(/(?<=[。！？!?])/)) { const t = s.trim(); if (t) out.push(t); }
  }
  return out;
}

export async function generateExplanation(question: string, refs: Chunk[] | null): Promise<{ answer: string; latency_ms: number }> {
  const user = refs ? `参考資料:\n${refs.map(fmt).join("\n\n")}\n\n質問: ${question}\n\n説明:` : `質問: ${question}\n\n説明:`;
  const t0 = performance.now();
  const r = await fetch(`${LLAMA_URL}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "local", messages: [{ role: "system", content: refs ? SYS_RAG : SYS_NONE }, { role: "user", content: user }], temperature: 0, max_tokens: 600, chat_template_kwargs: { enable_thinking: false } }) });
  if (!r.ok) throw new Error(`llama ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j: any = await r.json();
  return { answer: String(j.choices?.[0]?.message?.content ?? "").trim(), latency_ms: performance.now() - t0 };
}

const jev = new Client(JEV_URL, "systemone", 300_000, { x_noul_style: "letter", x_permutations: 2, x_heading: "document" }); // v2 構成
export async function checkSentence(sentence: string, refs: Chunk[]): Promise<{ p_ok: number | null; latency_ms: number; error?: string }> {
  const state = { 参考資料: refs.map(fmt), 説明文の一部: sentence };
  const res = await jev.decide(state, [{ name: "q", type: "noul", question: CHECK_INSTRUCTION }]);
  const r = res.answers.q;
  return { p_ok: r.probs ? r.probs[1] : null, latency_ms: res.latency_ms, ...(r.error ? { error: r.error } : {}) };
}

/** 全文をまとめて 1 リクエスト（文ごとの noul を同一 state で複数質問にする方法ではなく、文ごとに別 state）。UI 用に直列で返す */
export async function checkAll(sentences: string[], refs: Chunk[]) {
  const out = [];
  for (const s of sentences) out.push({ text: s, ...(await checkSentence(s, refs)) });
  return out;
}
