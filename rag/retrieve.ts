// 検索: クエリ埋め込み(bge-m3) → cos 上位 k。mode=hybrid は文字 bigram の BM25 とスコア融合（各スコアを min-max 正規化して alpha:1-alpha）
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { embed } from "./embed";
const D = resolve(import.meta.dir, "corpus");
export interface Chunk { id: string; section: string; page: number; text: string }
export const chunks: Chunk[] = readFileSync(join(D, "chunks.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const emb = JSON.parse(readFileSync(join(D, "embeddings.json"), "utf8")) as { ids: string[]; vectors: number[][] };
if (emb.ids.length !== chunks.length || emb.ids.some((id, i) => id !== chunks[i].id)) throw new Error("embeddings.json が chunks.jsonl と不整合。embed.ts を再実行");

const grams = (s: string): string[] => { const t = s.toLowerCase().replace(/\s+/g, ""); const g: string[] = []; for (let i = 0; i < t.length - 1; i++) g.push(t.slice(i, i + 2)); return g; };
const docG = chunks.map((c) => grams(c.text));
const df = new Map<string, number>(); for (const g of docG) for (const k of new Set(g)) df.set(k, (df.get(k) ?? 0) + 1);
const avgdl = docG.reduce((s, g) => s + g.length, 0) / docG.length;
const tf = docG.map((g) => { const m = new Map<string, number>(); for (const k of g) m.set(k, (m.get(k) ?? 0) + 1); return m; });
function bm25(q: string): number[] {
  const qg = [...new Set(grams(q))], N = chunks.length, k1 = 1.2, b = 0.75;
  return chunks.map((_, i) => { let s = 0; for (const g of qg) { const f = tf[i].get(g); if (!f) continue; const d = df.get(g)!; s += Math.log(1 + (N - d + 0.5) / (d + 0.5)) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * docG[i].length / avgdl)); } return s; });
}
const norm = (a: number[]) => { const mx = Math.max(...a), mn = Math.min(...a); return a.map((x) => (mx === mn ? 0 : (x - mn) / (mx - mn))); };

export type Mode = "dense" | "bm25" | "hybrid";
export async function retrieve(query: string, k: number, mode: Mode = "hybrid", alpha = 0.6): Promise<{ chunk: Chunk; score: number }[]> {
  let score: number[];
  const dense = async () => { const [q] = await embed([query]); return emb.vectors.map((v) => v.reduce((s, x, i) => s + x * q[i], 0)); };
  if (mode === "dense") score = await dense();
  else if (mode === "bm25") score = bm25(query);
  else { const d = norm(await dense()), l = norm(bm25(query)); score = d.map((x, i) => alpha * x + (1 - alpha) * l[i]); }
  return score.map((s, i) => ({ chunk: chunks[i], score: s })).sort((a, b) => b.score - a.score).slice(0, k);
}
if (import.meta.main) {
  const q = process.argv[2] ?? "He薄膜の超流動転移はどのように測定したか";
  for (const mode of ["dense", "bm25", "hybrid"] as Mode[]) { console.log(`--- ${mode}`); for (const r of await retrieve(q, 3, mode)) console.log(r.score.toFixed(3), r.chunk.id, `p${r.chunk.page}`, r.chunk.section, "|", r.chunk.text.slice(0, 60)); }
}
