// evidence_quote を含むチャンク（空白を無視して部分一致）を求める。evidence_chunk_ids があればそれを優先。見つからなければ bigram 重なり最大のチャンクで代替（found=false）
import { chunks } from "./retrieve";
const strip = (s: string) => s.replace(/\s+/g, "");
const stripped = chunks.map((c) => strip(c.text));
export interface Question { id: string; split: "calib" | "test"; type: "choice" | "noul"; question: string; options?: string[]; gold: number | string | boolean; evidence_quote: string; evidence_chunk_ids?: string[] }
export function goldChunkIds(q: Question): { ids: string[]; found: boolean } {
  if (q.evidence_chunk_ids?.length) return { ids: q.evidence_chunk_ids, found: true };
  const quote = strip(q.evidence_quote);
  const ids = chunks.filter((_, i) => stripped[i].includes(quote)).map((c) => c.id);
  if (ids.length) return { ids, found: true };
  const g = (s: string) => { const set = new Set<string>(); for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2)); return set; };
  const qg = g(quote);
  const scored = chunks.map((c, i) => { const cg = g(stripped[i]); let n = 0; for (const x of qg) if (cg.has(x)) n++; return { id: c.id, s: n / (qg.size || 1) }; }).sort((a, b) => b.s - a.s);
  return { ids: [scored[0].id], found: false };
}
/** gold を 0 始まり index に正規化: choice=選択肢 index（数値 or 選択肢文字列）、noul=yes→1/no→0 */
export function goldIndex(q: Question): number {
  if (q.type === "noul") return q.gold === true || q.gold === "yes" || q.gold === "true" || q.gold === 1 ? 1 : 0;
  if (typeof q.gold === "number") return q.gold;
  const i = q.options!.indexOf(String(q.gold));
  if (i < 0) throw new Error(`gold が options に無い: ${q.id}`);
  return i;
}
