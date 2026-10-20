// chunks.jsonl を bge-m3 (llama-server :8091 /v1/embeddings) で埋め込み、embeddings.json に保存
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const D = resolve(import.meta.dir, "corpus");
const URL = process.env.EMBED_URL ?? "http://localhost:8091/v1/embeddings";
const chunks = readFileSync(join(D, "chunks.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
export async function embed(texts: string[]): Promise<number[][]> {
  const r = await fetch(URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: texts, model: "bge-m3" }) });
  if (!r.ok) throw new Error(`embed HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j: any = await r.json();
  return j.data.sort((a: any, b: any) => a.index - b.index).map((d: any) => { const v: number[] = d.embedding; const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1; return v.map((x) => x / n); });
}
if (import.meta.main) {
  const vecs: number[][] = [];
  for (let i = 0; i < chunks.length; i += 8) { vecs.push(...(await embed(chunks.slice(i, i + 8).map((c) => c.text)))); if (i % 80 === 0) console.log(i, "/", chunks.length); }
  writeFileSync(join(D, "embeddings.json"), JSON.stringify({ model: "bge-m3", dim: vecs[0].length, normalized: true, ids: chunks.map((c) => c.id), vectors: vecs.map((v) => v.map((x) => +x.toFixed(6))) }));
  console.log("saved", vecs.length, "x", vecs[0].length);
}
