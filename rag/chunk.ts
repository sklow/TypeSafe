// thesis.txt -> chunks.jsonl（約 450 字・前後 80 字重なり、section/page メタ付き）。目次ページ（ドットリーダ行）は除外
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const D = resolve(import.meta.dir, "corpus");
const SIZE = 450, OVER = 80;
const heads = JSON.parse(readFileSync(join(D, "headings.json"), "utf8")).headings as { level: number; num: string; title: string; pdf_page: number }[];
const sectionOf = (page: number): string => {
  let cur = "前付け";
  for (const h of heads) if (h.pdf_page <= page) cur = `${h.num} ${h.title}`;
  return cur;
};
const raw = readFileSync(join(D, "thesis.txt"), "utf8");
const parts = raw.split(/<<<PAGE (\d+)>>>\n/).slice(1);
// 本文テキストを連結しつつ、各文字のページを記録
let text = ""; const pageAt: number[] = [];
for (let i = 0; i < parts.length; i += 2) {
  const page = +parts[i];
  let body = parts[i + 1];
  if (/\. \. \. \. \./.test(body)) continue; // 目次/図表目次
  // 行を整形: 空行除去、直前行と同一の行（見出し・キャプションの二重出力）を除去、日本語同士の改行は連結
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const dedup: string[] = [];
  for (const l of lines) if (dedup[dedup.length - 1] !== l && !/^\d{1,3}$/.test(l)) dedup.push(l); // 孤立ページ番号も除去
  let s = "";
  for (const l of dedup) { const prev = s.slice(-1); s += (/[　-鿿＀-￯、。）」]/.test(prev) && /[　-鿿＀-￯（「]/.test(l[0]) ? "" : " ") + l; }
  s = s.replace(/\s+/g, " ").trim() + " ";
  text += s; for (let k = 0; k < s.length; k++) pageAt.push(page);
}
const chunks: { id: string; section: string; page: number; text: string }[] = [];
for (let st = 0, n = 0; st < text.length; st += SIZE - OVER, n++) {
  const t = text.slice(st, st + SIZE).trim();
  if (t.length < 60) continue;
  const page = pageAt[st];
  chunks.push({ id: `c${String(chunks.length).padStart(4, "0")}`, section: sectionOf(page), page, text: t });
  if (st + SIZE >= text.length) break;
}
writeFileSync(join(D, "chunks.jsonl"), chunks.map((c) => JSON.stringify(c)).join("\n") + "\n");
console.log("chars", text.length, "chunks", chunks.length, "avg len", Math.round(chunks.reduce((s, c) => s + c.text.length, 0) / chunks.length));
console.log(JSON.stringify(chunks[40]), "\n", JSON.stringify(chunks[200]));
