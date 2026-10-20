// 画像版 Jev の評価ハーネス。:8793（server-vision）に投げて eval/metrics.ts の指標を出す。
// 使い方:
//   bun vision/run.ts --model qwen3.5-9b --api http://localhost:8793 [--pairs vision/pairs.jsonl] [--single vision/single.jsonl]
//       [--conds pair,pair-swap,single,text-only] [--limit N] [--out vision/results] [--cache-check]
// 条件: pair=2画像(図A=論文図,図B=比較図) / pair-swap=画像の提示順だけ入替（名前と役割は不変）/ single=論文図1枚 / text-only=画像なし（claim と質問のみ）
// pairs.jsonl: {id, split, thesis_fig, other_fig, claim, relation, gold_same_conclusion, questions:[{qid, type, instructions, options?, gold}]}
// single.jsonl: {id, split, fig, question:{qid,type,instructions,...}}（questions 配列形式も可）   画像パスは vision/ 基準の相対 or 絶対
// gold: choice=options の index か選択肢文字列 / noul=true|false|"yes"|"no" / score=0 始まり index
// __same = 「右の図は同じ結論か」の noul。データに qid=same_conclusion があればそれを使い、無ければ自動追加（gold=gold_same_conclusion）。
// 画像名は「図A（左の図・論文の図）」「図B（右の図・比較図）」（質問文の「左/右」と対応。swap は提示順のみ入替で名前は不変）。single の画像名は「図」。
// probs の規約は eval/run.ts と同じ: noul=[P(no),P(yes)]（gold true=1）、choice=options 順、score=0..L-1。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import { argmax, evalBlock, mean, percentile } from "../eval/metrics";

const HERE = import.meta.dir;
const { values: a } = parseArgs({
  options: {
    model: { type: "string" }, api: { type: "string", default: "http://localhost:8793" },
    pairs: { type: "string", default: join(HERE, "pairs.jsonl") }, single: { type: "string", default: join(HERE, "single.jsonl") },
    conds: { type: "string", default: "pair,pair-swap,single,text-only" }, limit: { type: "string" },
    out: { type: "string", default: join(HERE, "results") }, "cache-check": { type: "boolean", default: false }, label: { type: "string" }, "figs-dir": { type: "string" },
  },
});
if (!a.model) { console.error("--model required"); process.exit(2); }
const OUT = resolve(a.out!);
mkdirSync(join(OUT, a.model), { recursive: true });
const readJsonl = (p: string): any[] => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const abs = (p: string) => (isAbsolute(p) ? p : resolve(HERE, a["figs-dir"] ? p.replace(/^figs\//, a["figs-dir"] + "/") : p)); // --figs-dir figs512: figs/ を別ディレクトリ(縮小版)に差し替え
const lim = a.limit ? Number(a.limit) : Infinity;
const pairs = readJsonl(resolve(a.pairs!)).slice(0, lim), singles = readJsonl(resolve(a.single!)).slice(0, lim);

// ---- 質問の変換 ----
// 標準質問 __same の既定（データに qid=same_conclusion があればそれを __same として扱い、自動追加しない）
const SAME_Q = {
  type: "noul", qid: "__same",
  instructions: "右の図（図B）も、左の図（図A）が示す結論と同じ結論を示しているか。逆の結論や無関係な図であれば no。",
  gold: true,
};
const isSame = (id: string) => id === "__same" || id === "same_conclusion";
const qText = (q: any) => q.instructions ?? q.question;
const qIdOf = (q: any, i: number) => q.qid ?? q.id ?? `q${i}`;
const optNames = (o: any): string[] => (Array.isArray(o) ? o.map((x) => (typeof x === "string" ? x : String(x.key ?? x.name ?? x.label))) : Object.keys(o));
const optDescs = (o: any): any[] => (Array.isArray(o) ? o.map((x) => (typeof x === "string" ? null : (x.description ?? null))) : Object.values(o));
function qSpec(q: any) {
  if (q.type === "noul") return { type: "noul", instructions: qText(q) };
  const names = optNames(q.options), descs = optDescs(q.options);
  if (q.type === "score") return { type: "score", instructions: qText(q), criteria: q.levels ?? q.options };
  return { type: "choice", instructions: qText(q), criteria: Object.fromEntries(names.map((n, i) => [n, descs[i]])) };
}
function goldIdx(q: any): number {
  const g = q.gold;
  if (q.type === "noul") return g === true || String(g).toLowerCase() === "yes" || String(g).toLowerCase() === "true" ? 1 : 0;
  if (typeof g === "number") return g;
  const i = optNames(q.options).indexOf(String(g));
  if (i < 0) throw new Error(`gold not found in options: ${g}`);
  return i;
}
const Kof = (q: any) => (q.type === "noul" ? 2 : q.type === "score" ? (q.levels ?? q.options).length : optNames(q.options).length);

// ---- 条件ごとのリクエスト ----
interface Item { id: string; split: string; relation?: string; images: { name: string; path: string }[]; state: string; qs: any[] }
function build(cond: string): Item[] {
  if (cond === "single") return singles.map((s) => ({
    id: s.id, split: s.split ?? "test", images: [{ name: "図", path: abs(s.thesis_fig ?? s.fig ?? s.image) }],
    state: "図は、ある論文に掲載されている 1 枚の図である。この図についての質問に答える。", qs: sq(s),
  }));
  if (cond === "text-only") return [
    ...pairs.map((p) => ({ id: p.id, split: p.split ?? "test", relation: p.relation, images: [], state: `論文の主張: ${p.claim}\n（左右の図は提示されていない。図なしで答えること。）`, qs: pq(p) })),
    ...singles.map((s) => ({ id: s.id, split: s.split ?? "test", images: [], state: "質問はある論文の図 1 枚について尋ねているが、図は提示されていない（図なしで答えること）。", qs: sq(s) })),
  ];
  const swap = cond === "pair-swap";
  return pairs.map((p) => {
    const A = { name: "図A（左の図・論文の図）", path: abs(p.thesis_fig) }, B = { name: "図B（右の図・比較図）", path: abs(p.other_fig) };
    return {
      id: p.id, split: p.split ?? "test", relation: p.relation, images: swap ? [B, A] : [A, B],
      state: `論文の主張: ${p.claim}\n図A（左の図）はこの主張を支える論文の図。図B（右の図）は別の出典の比較用の図。`, qs: pq(p),
    };
  });
}
const pq = (p: any) => {
  const qs = p.questions.map((q: any, i: number) => ({ ...q, id: qIdOf(q, i) }));
  return qs.some((q: any) => isSame(q.id)) ? qs : [...qs, { ...SAME_Q, id: "__same", gold: p.gold_same_conclusion }];
};
const sq = (s: any) => (s.questions ?? [s.question]).map((q: any, i: number) => ({ ...q, id: qIdOf(q, i) }));

// ---- 実行 ----
interface QRec {
  id: string; item: string; cond: string; qid: string; split: string; relation?: string; type: string; K: number; gold: number;
  probs: number[] | null; pred: number | null; conf: number | null; latency_ms: number; server_latency_ms?: number; n_q: number;
  mass_on_labels?: number; flip?: boolean | null; cache_n?: number; error?: string;
}
async function call(item: Item) {
  const questions = Object.fromEntries(item.qs.map((q) => [q.id, qSpec(q)]));
  const body = { state: item.state, questions, x_images: item.images };
  const t0 = performance.now();
  const res = await fetch(`${a.api}/v1/systemone`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(600_000) });
  const lat = performance.now() - t0;
  const j: any = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${j.error}`);
  return { j, lat };
}
function probsOf(q: any, ans: any): number[] {
  if (q.type === "noul") return [1 - ans.noul, ans.noul];
  if (q.type === "score") return Object.keys(ans.probabilities).sort((x, y) => +x - +y).map((k) => ans.probabilities[k]);
  return optNames(q.options).map((n) => ans.probabilities[n]);
}
async function runCond(cond: string): Promise<QRec[]> {
  const file = join(OUT, a.model!, `${cond}.jsonl`);
  const done = new Map<string, QRec[]>();
  for (const r of readJsonl(file) as QRec[]) if (!r.error) done.set(r.item, [...(done.get(r.item) ?? []), r]);
  const items = build(cond);
  const all: QRec[] = [];
  for (const it of items) {
    if (done.has(it.id)) { all.push(...done.get(it.id)!); continue; }
    let recs: QRec[];
    try {
      const { j, lat } = await call(it);
      recs = it.qs.map((q) => {
        const p = probsOf(q, j.answers[q.id]), dbg = j.x_debug.questions[q.id];
        return { id: `${cond}:${it.id}:${q.id}`, item: it.id, cond, qid: q.id, split: it.split, relation: it.relation, type: q.type, K: Kof(q), gold: goldIdx(q),
          probs: p, pred: argmax(p), conf: Math.max(...p), latency_ms: lat, server_latency_ms: j.x_debug.latency_ms, n_q: it.qs.length,
          mass_on_labels: dbg.mass_on_labels, flip: dbg.flip, cache_n: dbg.orders?.[1]?.cache_n ?? dbg.cache_n };
      });
    } catch (e: any) {
      recs = it.qs.map((q) => ({ id: `${cond}:${it.id}:${q.id}`, item: it.id, cond, qid: q.id, split: it.split, relation: it.relation, type: q.type, K: Kof(q), gold: goldIdx(q),
        probs: null, pred: null, conf: null, latency_ms: 0, n_q: it.qs.length, error: String(e.message ?? e) }));
      console.error(`[${cond}] ${it.id} error: ${e.message}`);
    }
    all.push(...recs);
    writeFileSync(file, (readJsonl(file) as QRec[]).filter((r) => r.item !== it.id).concat(recs).map((r) => JSON.stringify(r)).join("\n") + "\n");
    process.stderr.write(`[${cond}] ${all.length} q\r`);
  }
  return all;
}

// ---- 集計 ----
const r4 = (x: number | null) => (x == null || !isFinite(x) ? null : Math.round(x * 10000) / 10000);
function block(rs: QRec[]) {
  const ok = rs.filter((r) => r.probs);
  if (!ok.length) return null;
  const Kmax = Math.max(...ok.map((r) => r.K));
  const b = evalBlock(ok.map((r) => r.probs!), ok.map((r) => r.gold), "choice", Kmax);
  return { n: ok.length, n_err: rs.length - ok.length, acc: r4(b.accuracy), ece: r4(b.ece), auroc: r4(b.auroc), cov_at_prec95: r4(b.max_cov_at_prec_95), mean_conf: r4(b.mean_conf), brier: r4(b.brier) };
}
function summarize(recs: QRec[]) {
  const ok = recs.filter((r) => r.probs);
  const items = new Map<string, number>();
  for (const r of ok) items.set(r.item, r.latency_ms);
  const by = (f: (r: QRec) => boolean) => block(ok.filter(f));
  const same = ok.filter((r) => isSame(r.qid));
  const byRel: Record<string, any> = {};
  for (const rel of ["same", "opposite", "unrelated"]) byRel[rel] = by((r) => r.relation === rel);
  // opposite を same と誤認（__same で yes と予測）したときの確信度
  const opp = same.filter((r) => r.relation === "opposite");
  const wrong = opp.filter((r) => r.pred === 1);
  const flips = ok.filter((r) => r.flip != null);
  const masses = ok.map((r) => r.mass_on_labels).filter((x): x is number => typeof x === "number");
  return {
    all: block(ok), by_relation: byRel, same_question: block(same), same_question_by_relation: Object.fromEntries(["same", "opposite", "unrelated"].map((rel) => [rel, block(same.filter((r) => r.relation === rel))])),
    by_type: Object.fromEntries(["choice", "noul", "score"].map((t) => [t, by((r) => r.type === t && !isSame(r.qid))])),
    opposite_judged_same: { n_opposite: opp.length, n_wrong: wrong.length, rate: r4(opp.length ? wrong.length / opp.length : null), mean_conf_when_wrong: r4(wrong.length ? mean(wrong.map((r) => r.conf!)) : null) },
    mass_on_labels_mean: r4(masses.length ? mean(masses) : null), mass_on_labels_min: r4(masses.length ? Math.min(...masses) : null),
    flip_rate: r4(flips.length ? flips.filter((r) => r.flip).length / flips.length : null),
    latency_ms_p50_item: r4(items.size ? percentile([...items.values()], 0.5) : null), latency_ms_p90_item: r4(items.size ? percentile([...items.values()], 0.9) : null),
    n_items: items.size, n_q: ok.length, n_err: recs.length - ok.length,
  };
}

// ---- KV キャッシュ再利用の確認: 同一アイテムを 2 回投げて cache_n / latency を比較 ----
async function cacheCheck() {
  const it = build("pair")[0] ?? build("single")[0];
  const rows: any[] = [];
  for (const label of ["cold", "warm(同一リクエスト再送)"]) {
    const { j, lat } = await call(it);
    const qs = Object.values<any>(j.x_debug.questions);
    rows.push({ run: label, latency_ms: Math.round(lat), input_tokens: j.usage.input_tokens, cache_n_per_question: qs.map((q) => q.orders?.map((o: any) => o.cache_n) ?? q.cache_n) });
  }
  return rows;
}

const summaryPath = join(OUT, "summary.json");
const summary: any = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, "utf8")) : {};
const m = (summary[a.model] ??= { conds: {} });
m.api = a.api; m.updated = new Date().toISOString();
if (a["cache-check"]) m.cache_check = await cacheCheck();
for (const cond of a.conds!.split(",").filter(Boolean)) {
  const recs = await runCond(cond);
  if (recs.length) m.conds[cond] = summarize(recs);
  console.error(`\n[${cond}] done: ${JSON.stringify(m.conds[cond]?.all)}`);
}
writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

// ---- RESULTS.md ----
const f = (x: any, d = 3) => (x == null ? "-" : typeof x === "number" ? x.toFixed(d) : String(x));
const CONDS = ["pair", "pair-swap", "single", "text-only"];
let md = `# 画像版 Jev 評価結果\n\n自動生成（\`bun vision/run.ts\`）。サーバ: server-vision（NOUL_STYLE=letter, PERMUTATIONS=2）。レイテンシは concurrency 1、アイテム単位（1 リクエスト＝全質問）の p50。\n\n`;
md += `## モデル × 条件（全質問）\n\n| model | cond | n_q | acc | ECE | AUROC | cov@prec95 | mass_on_labels | flip率 | latency p50 (ms/item) |\n|---|---|---|---|---|---|---|---|---|---|\n`;
for (const [mod, v] of Object.entries<any>(summary)) for (const c of CONDS) { const s = v.conds[c]; if (!s?.all) continue;
  md += `| ${mod} | ${c} | ${s.n_q} | ${f(s.all.acc)} | ${f(s.all.ece)} | ${f(s.all.auroc)} | ${f(s.all.cov_at_prec95)} | ${f(s.mass_on_labels_mean)} | ${f(s.flip_rate)} | ${f(s.latency_ms_p50_item, 0)} |\n`; }
md += `\n## relation 別 正答率（全質問 / __same 質問）\n\n| model | cond | same | opposite | unrelated | __same: same | __same: opposite | __same: unrelated |\n|---|---|---|---|---|---|---|---|\n`;
for (const [mod, v] of Object.entries<any>(summary)) for (const c of ["pair", "pair-swap", "text-only"]) { const s = v.conds[c]; if (!s) continue;
  md += `| ${mod} | ${c} | ${["same", "opposite", "unrelated"].map((r) => f(s.by_relation[r]?.acc)).join(" | ")} | ${["same", "opposite", "unrelated"].map((r) => f(s.same_question_by_relation[r]?.acc)).join(" | ")} |\n`; }
md += `\n## opposite を same と誤認したとき（__same 質問）\n\n| model | cond | n_opposite | 誤認数 | 誤認率 | 誤認時の平均確信度 |\n|---|---|---|---|---|---|\n`;
for (const [mod, v] of Object.entries<any>(summary)) for (const c of ["pair", "pair-swap", "text-only"]) { const o = v.conds[c]?.opposite_judged_same; if (!o) continue;
  md += `| ${mod} | ${c} | ${o.n_opposite} | ${o.n_wrong} | ${f(o.rate)} | ${f(o.mean_conf_when_wrong)} |\n`; }
md += `\n## KV キャッシュ再利用（同一リクエスト再送）\n\n`;
for (const [mod, v] of Object.entries<any>(summary)) if (v.cache_check) { md += `**${mod}**\n\n`; for (const r of v.cache_check) md += `- ${r.run}: ${r.latency_ms} ms, input_tokens=${r.input_tokens}, cache_n=${JSON.stringify(r.cache_n_per_question)}\n`; md += "\n"; }
md += `\n## 注記\n\n- pair-swap は画像の提示順のみ入替（名前と役割＝図A=論文図は不変）。pair との差が位置バイアス。\n- text-only は画像なし。pair/single より大きく劣れば「画像を見ないと解けない」ことの確認になる。\n- __same は全 pair アイテムに自動追加した標準質問（gold=gold_same_conclusion）。\n- noul の probs=[P(no),P(yes)]。confidence = argmax 確率（確率分布の最大値）。\n`;
writeFileSync(join(HERE, "RESULTS.md"), md);
console.error("wrote RESULTS.md / summary.json");
