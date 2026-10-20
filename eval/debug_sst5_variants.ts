// sst5 診断: (a) raw データの label↔label_text 対応 (b) criteria 逆順提示 (c) v2 サーバの x_heading=evidence で、混同行列と acc を比較
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
const ROOT = resolve(import.meta.dir, "..");
const meta = JSON.parse(readFileSync(join(ROOT, "data/tasks/sst5.meta.json"), "utf8"));
const items = readFileSync(join(ROOT, "data/tasks/sst5.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const raw = readFileSync(join(ROOT, "data/raw/sst5/test.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const map: Record<string, Set<string>> = {};
for (const r of raw) (map[r.label] ??= new Set()).add(r.label_text);
console.log("(a) raw label -> label_text:", JSON.stringify(Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v]]))));
let bad = 0; for (const it of items) if (raw[it.src_idx].label + 1 !== it.gold || raw[it.src_idx].text !== it.state) bad++;
console.log("   tasks jsonl の gold/state と raw の不一致:", bad, "/", items.length);

async function run(label: string, api: string, rev: boolean, ext: any = {}) {
  const crit = rev ? [...meta.level_labels].reverse() : meta.level_labels;
  const M = Array.from({ length: 5 }, () => new Array(5).fill(0));
  let i = 0;
  await Promise.all([0, 1].map(async () => { while (i < items.length) { const it = items[i++];
    const body = { state: it.state, questions: { q: { type: "score", instructions: meta.question, criteria: crit } }, ...ext };
    const r: any = await (await fetch(`${api}/v1/systemone`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
    let p = Object.keys(r.answers.q.probabilities).sort().map((k) => r.answers.q.probabilities[k]);
    if (rev) p = p.reverse();
    M[it.gold - 1][p.indexOf(Math.max(...p))]++;
  } }));
  const acc = M.reduce((s, row, g) => s + row[g], 0) / items.length, o1 = M.reduce((s, row, g) => s + row.reduce((t, x, k) => t + (Math.abs(g - k) <= 1 ? x : 0), 0), 0) / items.length;
  console.log(`\n(${label}) acc=${(100 * acc).toFixed(1)}% off-by-one=${(100 * o1).toFixed(1)}%  混同行列(行 gold 1..5, 列 pred 1..5; calib+test 200 件)`);
  M.forEach((row, g) => console.log(`  gold ${g + 1} ` + row.map((x) => String(x).padStart(4)).join("")));
}
await run("b: criteria を逆順で提示（very positive が 0）", "http://localhost:8788", true);
await run("c: v2 サーバ x_heading=evidence", "http://localhost:8789", false, { x_heading: "evidence" });
