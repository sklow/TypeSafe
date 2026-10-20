// 最終版.pdf の pdftotext 出力(thesis.raw.txt)に、ページ区切りマーカーと章節見出し(main.toc 由来)を付けて thesis.txt / headings.json を作る
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const D = resolve(import.meta.dir, "corpus"), S = resolve(import.meta.dir, "source");
const raw = readFileSync(join(D, "thesis.raw.txt"), "utf8");
const pages = raw.split("\f"); if (!pages[pages.length - 1].trim()) pages.pop();
// toc: 章=section(level1)、節=subsection(level2)、印字ページ番号。PDF ページとの offset は、章見出し「序論」の出現で決める
type H = { level: 1 | 2; num: string; title: string; printed: number };
const heads: H[] = [];
for (const l of readFileSync(join(S, "main.toc"), "utf8").split("\n")) {
  const m = l.match(/contentsline \{(section|subsection)\}\{\\numberline \{([^}]*)\}(.*?)\}\{(\d+)\}\{/);
  if (m) heads.push({ level: m[1] === "section" ? 1 : 2, num: m[2], title: m[3].replace(/\$\\cdot \$/g, "・").replace(/\$[^$]*\$/g, "").replace(/\\[a-zA-Z]+\s?/g, "").trim(), printed: +m[4] });
}
// offset: 印字ページ 1（序論）が現れる PDF ページ。目次の後ろで「ヘリウム」節見出しを含む最初のページ
let offset = -1;
for (let i = 5; i < pages.length; i++) if (/1\.1\s*\n?\s*ヘリウム/.test(pages[i]) && !/\. \. \. \./.test(pages[i])) { offset = i + 1 - 1; break; }
console.log("見出し数", heads.length, "offset(pdf page index of printed p1) =", offset);
const out = pages.map((p, i) => `<<<PAGE ${i + 1}>>>\n${p.trim()}\n`).join("\n");
writeFileSync(join(D, "thesis.txt"), out);
writeFileSync(join(D, "headings.json"), JSON.stringify({ offset_pdf_page_of_printed_1: offset + 1, pdf_pages: pages.length, headings: heads.map((h) => ({ ...h, pdf_page: h.printed + offset })) }, null, 1));
console.log("chars", out.length, "pdf pages", pages.length);
