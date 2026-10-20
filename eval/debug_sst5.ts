// sst5 異常の調査用: (1) 混同行列 (2) 手作り文での API 応答 (3) サーバが組み立てるプロンプト全文
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { planScore, SYSTEM, userPrefix } from "../server/prompts";

const ROOT = resolve(import.meta.dir, "..");
const meta = JSON.parse(readFileSync(join(ROOT, "data/tasks/sst5.meta.json"), "utf8"));
const items = readFileSync(join(ROOT, "data/tasks/sst5.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const goldById = new Map(items.map((i) => [i.id, i]));

for (const run of process.argv.slice(2)) {
  const recs = new Map<string, any>();
  for (const l of readFileSync(join(ROOT, "eval/results", run, "sst5.jsonl"), "utf8").trim().split("\n")) { const r = JSON.parse(l); recs.set(r.id, r); }
  const M = Array.from({ length: 5 }, () => new Array(5).fill(0));
  for (const r of recs.values()) if (r.probs) M[r.gold][r.pred]++;
  console.log(`\n== 混同行列 ${run}（行=gold level1..5, 列=pred level1..5, calib+test ${recs.size} 件）`);
  console.log("        " + [1, 2, 3, 4, 5].map((k) => `p${k}`.padStart(5)).join(""));
  M.forEach((row, g) => console.log(`gold ${g + 1}  ` + row.map((x) => String(x).padStart(5)).join("")));
  // gold の level 平均予測確率
  const mp = Array.from({ length: 5 }, () => new Array(5).fill(0)), n = new Array(5).fill(0);
  for (const r of recs.values()) if (r.probs) { n[r.gold]++; r.probs.forEach((p: number, k: number) => (mp[r.gold][k] += p)); }
  console.log("-- gold 別の平均確率");
  mp.forEach((row, g) => console.log(`gold ${g + 1}  ` + row.map((x) => (x / n[g]).toFixed(2).padStart(5)).join("")));
}

// (2) 手作り文
const crit = meta.level_labels;
const probes: [string, string][] = [
  ["very negative", "This is a complete disaster, a painfully dull and utterly worthless film that I hated from start to finish."],
  ["very negative", "An unwatchable, soul-crushing mess; easily the worst movie I have ever seen."],
  ["negative", "A tedious film with a few decent moments but mostly forgettable and disappointing."],
  ["neutral", "The film runs ninety minutes and follows a family through a summer in a small town."],
  ["neutral", "It is neither good nor bad; some scenes work and others do not."],
  ["positive", "A charming and well-acted film that is pleasant to watch."],
  ["very positive", "A masterpiece! Brilliant, moving, and unforgettable; I loved every minute of it."],
  ["very positive", "Absolutely stunning, the best film of the year, with flawless performances and a gorgeous script."],
];
console.log("\n== 手作り文への API 応答（:8788, sst5 と同じ question/criteria）");
for (const [want, text] of probes) {
  const body = { state: text, questions: { q: { type: "score", instructions: meta.question, criteria: crit } } };
  const r: any = await (await fetch("http://localhost:8788/v1/systemone", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const a = r.answers.q;
  console.log(`[期待: ${want}] keys=${Object.keys(a.probabilities).join(",")} legend=${JSON.stringify(a.legend)}`);
  console.log("   probs=" + Object.values<number>(a.probabilities).map((x) => x.toFixed(2)).join(" ") + `  first_token=${r.x_debug.questions.q.first_token} mass=${r.x_debug.questions.q.mass_on_labels.toFixed(3)}  score=${a.score.toFixed(2)}`);
}

// (3) プロンプト全文（実際の chat 文字列は llama-server の /apply-template でレンダリング）
const ex = items.find((i) => i.split === "test")!;
const task = planScore({ type: "score", instructions: meta.question, criteria: crit } as any);
const user = userPrefix(ex.state) + task.suffix;
console.log("\n== system:\n" + SYSTEM + "\n\n== user:\n" + user + `\n\n(この例の gold = level ${ex.gold} = "${crit[ex.gold - 1]}")`);
const tpl: any = await (await fetch("http://127.0.0.1:8081/apply-template", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }], chat_template_kwargs: { enable_thinking: false } }) })).json();
console.log("\n== chat template 適用後の文字列（llama-server /apply-template）:\n" + JSON.stringify(tpl.prompt ?? tpl).slice(0, 3000));
