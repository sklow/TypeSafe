// 使い方:
//   bun eval/run.ts --model <name> --api http://localhost:8788 --tasks all --out eval/results/<model>/ [--concurrency 4] [--limit N（calib/test 半々）] [--protocol auto|systemone|decide] [--mock] [--reverse-options（choice の提示順を反転。確率は元の順に戻して記録）] [--allow-prompt-change] [--config v1|v2 ラベル] [--x-noul-style yesno|letter] [--x-heading document|evidence] [--x-permutations 1|2]（v2 サーバ用の拡張）
//   bun eval/run.ts --model <name> --api ... --latency-bench --out eval/results/<model>/     (--tasks 未指定ならレイテンシ測定のみ)
// 1 アイテム = 1 state = 1 質問。生結果は <out>/<task>.jsonl に追記（再実行時は成功済み id をスキップ、エラー行は再試行）。
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { Client, mockDecide, type QSpec, type Protocol } from "./api";
import { percentile } from "./metrics";

const ROOT = resolve(import.meta.dir, "..");
const TASK_DIR = join(ROOT, "data/tasks");

const { values: a } = parseArgs({
  options: {
    model: { type: "string" }, api: { type: "string" }, tasks: { type: "string" }, out: { type: "string" },
    concurrency: { type: "string", default: "4" }, limit: { type: "string" }, protocol: { type: "string", default: "auto" },
    "latency-bench": { type: "boolean", default: false }, "reverse-options": { type: "boolean", default: false }, "x-noul-style": { type: "string" }, "x-heading": { type: "string" }, "x-permutations": { type: "string" }, config: { type: "string", default: "v1" }, "server-dir": { type: "string", default: "server" }, "allow-prompt-change": { type: "boolean", default: false }, mock: { type: "boolean", default: false }, runs: { type: "string", default: "20" },
  },
});
if (!a.model || !a.out || (!a.api && !a.mock)) {
  console.error("usage: bun eval/run.ts --model <name> --api <url> [--tasks all|a,b] --out <dir> [--concurrency 4] [--limit N] [--latency-bench] [--mock]");
  process.exit(2);
}
const out = resolve(a.out);
mkdirSync(out, { recursive: true });
const ext: Record<string, unknown> = {};
if (a["x-noul-style"]) ext.x_noul_style = a["x-noul-style"];
if (a["x-heading"]) ext.x_heading = a["x-heading"];
if (a["x-permutations"]) ext.x_permutations = Number(a["x-permutations"]);
const client = new Client(a.api ?? "mock", a.protocol as Protocol, 180_000, ext);

const allTasks = readdirSync(TASK_DIR).filter((f) => f.endsWith(".meta.json")).map((f) => f.replace(/\.meta\.json$/, "")).sort();
const wantBenchOnly = a["latency-bench"] && !a.tasks;
const isExpl = (t: string) => !!JSON.parse(readFileSync(join(TASK_DIR, `${t}.meta.json`), "utf8")).exploratory;
const tasks = wantBenchOnly ? [] : !a.tasks || a.tasks === "all" ? allTasks.filter((t) => !isExpl(t)) : a.tasks.split(","); // exploratory タスクは名前を明示したときだけ実行
for (const t of tasks) if (!allTasks.includes(t)) { console.error(`unknown task ${t}; available: ${allTasks.join(", ")}`); process.exit(2); }

const readJsonl = (p: string): any[] => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

function specOf(meta: any, item: any): QSpec {
  return {
    name: "q", type: meta.type, question: item.question ?? meta.question,
    options: meta.options, levels: meta.levels, level_labels: meta.level_labels,
  };
}
/** gold を 0 始まりのクラス index に変換（noul: false=0/true=1, score: level-1, choice: そのまま） */
const goldIndex = (meta: any, g: any): number => (meta.type === "noul" ? (g ? 1 : 0) : meta.type === "score" ? g - 1 : g);
const Kof = (meta: any): number => (meta.type === "noul" ? 2 : meta.type === "score" ? meta.levels : meta.options.length);

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => { while (i < items.length) { const x = items[i++]; await fn(x); } }));
}

// ---- 来歴: サーバのプロンプト/データ定義のハッシュを記録（プロンプト凍結後の再取得や、混在 run の検出用）----
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const SERVER_DIR = resolve(ROOT, a["server-dir"]!); // v2 サーバは --server-dir server-v2
const serverFiles = existsSync(SERVER_DIR) ? readdirSync(SERVER_DIR).filter((f) => f.endsWith(".ts")).sort() : [];
const prov = {
  prompts_sha256: existsSync(join(SERVER_DIR, "prompts.ts")) ? sha(join(SERVER_DIR, "prompts.ts")) : null,
  server_sha256: Object.fromEntries(serverFiles.map((f) => [f, sha(join(SERVER_DIR, f))])),
  tasks_meta_sha256: Object.fromEntries(allTasks.map((t) => [t, sha(join(TASK_DIR, `${t}.meta.json`))])),
  tasks_data_sha256: Object.fromEntries(allTasks.map((t) => [t, sha(join(TASK_DIR, `${t}.jsonl`))])),
};
const infoPath = join(out, "run_info.json");
const prev = existsSync(infoPath) ? JSON.parse(readFileSync(infoPath, "utf8")) : null;
if (prev && prev.prompts_sha256 !== prov.prompts_sha256 && !a["allow-prompt-change"]) {
  console.error(`この出力先は別のプロンプト版で実行済み（prompts.ts sha256 ${String(prev.prompts_sha256).slice(0, 8)} → 現在 ${String(prov.prompts_sha256).slice(0, 8)}）。結果の混在を避けるため別の --out を使うこと（意図的なら --allow-prompt-change）`);
  process.exit(3);
}
if (prev && !!prev.reverse_options !== !!a["reverse-options"]) { console.error("この出力先は --reverse-options の設定が異なる run で作成済み。別の --out を使うこと"); process.exit(3); }
const changedTasks = tasks.filter((t) => prev?.tasks_meta_sha256?.[t] && (prev.tasks_meta_sha256[t] !== prov.tasks_meta_sha256[t] || prev.tasks_data_sha256?.[t] !== prov.tasks_data_sha256[t]));
if (changedTasks.length && !a["allow-prompt-change"]) { console.error(`タスク定義が変わっている: ${changedTasks.join(", ")}。別の --out を使うこと（意図的なら --allow-prompt-change）`); process.exit(3); }
if (prev && JSON.stringify(prev.ext ?? {}) !== JSON.stringify(ext) && !a["allow-prompt-change"]) { console.error("この出力先は x_* 拡張オプションが異なる run で作成済み。別の --out を使うこと"); process.exit(3); }
const inv = { at: new Date().toISOString(), argv: process.argv.slice(2), reverse_options: a["reverse-options"] };
writeFileSync(infoPath, JSON.stringify({
  model: a.model, api: a.api ?? "mock", protocol: a.protocol, mock: a.mock, first_started_at: prev?.first_started_at ?? inv.at,
  reverse_options: a["reverse-options"], config: a.config, ext, server_dir: a["server-dir"], ...prov, invocations: [...(prev?.invocations ?? []), inv],
}, null, 1));

for (const task of tasks) {
  const meta = JSON.parse(readFileSync(join(TASK_DIR, `${task}.meta.json`), "utf8"));
  let items = readJsonl(join(TASK_DIR, `${task}.jsonl`));
  if (a.limit) { // 動作確認用: calib と test を半々に取る（どちらの指標も出るように）
    const L = Number(a.limit), c = items.filter((x) => x.split === "calib"), t = items.filter((x) => x.split === "test");
    items = [...c.slice(0, Math.ceil(L / 2)), ...t.slice(0, Math.floor(L / 2))];
  }
  const file = join(out, `${task}.jsonl`);
  const done = new Set(readJsonl(file).filter((r) => !r.error).map((r) => r.id));
  const todo = items.filter((it) => !done.has(it.id));
  console.log(`[${task}] ${items.length} items, ${done.size} already done, ${todo.length} to run`);
  let n = 0, errs = 0;
  const t0 = performance.now();
  await pool(todo, Number(a.concurrency), async (it) => {
    const q = specOf(meta, it);
    const gi = goldIndex(meta, it.gold);
    const rev = a["reverse-options"] && q.type === "choice"; // 位置バイアス診断: 選択肢を逆順で提示し、確率は元の順に戻して記録
    if (rev) q.options = [...q.options!].reverse();
    let res = a.mock ? await mockDecide(it.id, q, gi) : await client.decide(it.state, [q]);
    if (meta.harness_perm2 && q.type === "score" && !a.mock) {
      // 探索: criteria を逆順にして 2 回目を投げ、レベル順に戻して算術平均（orders に各順序を保存）。レイテンシは合計
      const r2 = await client.decide(it.state, [{ ...q, level_labels: [...q.level_labels!].reverse() }]);
      const a1 = res.answers.q, a2 = r2.answers.q;
      const back = a2.probs ? a2.probs.slice().reverse() : null;
      if (a1.probs && back) {
        const avg = a1.probs.map((p, k) => (p + back[k]) / 2);
        const pred = avg.indexOf(Math.max(...avg));
        res = { ...res, latency_ms: res.latency_ms + r2.latency_ms, server_latency_ms: (res.server_latency_ms ?? 0) + (r2.server_latency_ms ?? 0),
          answers: { q: { ...a1, probs: avg, pred, conf: avg[pred], expected: avg.reduce((s, x, k) => s + x * (k + 1), 0), orders: [a1.probs, back], flip: a1.probs.indexOf(Math.max(...a1.probs)) !== back.indexOf(Math.max(...back)), mass_on_labels: ((a1.mass_on_labels ?? 0) + (a2.mass_on_labels ?? 0)) / 2 } } };
      } else res = { ...res, answers: { q: { ...a1, probs: null, error: a1.error ?? a2.error ?? "perm2 failed", format_ok: false } } };
    }
    const r = res.answers.q;
    if (rev && r.probs) { r.probs = r.probs.slice().reverse(); r.pred = r.probs.length - 1 - r.pred!; if (r.orders) r.orders = r.orders.map((o) => o.slice().reverse()); }
    const rec = {
      id: it.id, task, split: it.split, type: meta.type, K: Kof(meta), gold: gi, probs: r.probs, pred: r.pred, conf: r.conf,
      expected: r.expected, server_conf: r.server_conf, latency_ms: res.latency_ms, server_latency_ms: res.server_latency_ms,
      mass_on_labels: r.mass_on_labels, orders: r.orders, flip: r.flip, server_model: res.server_model ?? null, format_ok: r.format_ok, ...(r.error ? { error: r.error } : {}),
    };
    appendFileSync(file, JSON.stringify(rec) + "\n");
    n++; if (r.error || !r.format_ok) errs++;
    if (n % 20 === 0 || n === todo.length) console.log(`[${task}] ${n}/${todo.length} (err/format-violation ${errs}) ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  });
}

// ---- レイテンシ測定: 1 state × 3 質問（noul + choice + score）同時 ----
if (a["latency-bench"]) {
  const boolq = readJsonl(join(TASK_DIR, "boolq.jsonl"));
  const runs = Number(a.runs), warm = 3;
  const mkQs = (it: any): QSpec[] => [
    { name: "answerable", type: "noul", question: it.question },
    { name: "topic", type: "choice", question: "What is the main topic of this passage?", options: ["Politics and law", "Sports and entertainment", "Science and technology", "History and geography", "Other"] },
    { name: "difficulty", type: "score", levels: 5, question: "How difficult is this passage to read?", level_labels: ["very easy", "easy", "moderate", "difficult", "very difficult"] },
  ];
  const call = async (it: any, qs: QSpec[]) => {
    if (a.mock) { const r = await mockDecide(it.id, qs[0], 0); return { ...r, http_error: undefined as string | undefined }; }
    return client.decide(it.state, qs);
  };
  const summarize = (xs: number[]) => ({ n: xs.length, p50: percentile(xs, 0.5), p90: percentile(xs, 0.9), mean: xs.reduce((s, x) => s + x, 0) / (xs.length || 1) });
  const bench = async (label: string, qsOf: (it: any) => QSpec[], varyState: boolean) => {
    const lat: number[] = [], slat: number[] = []; let bad = 0;
    for (let i = 0; i < warm + runs; i++) {
      const it = varyState ? boolq[1 + i] : boolq[0]; // vary: 毎回別 state（KV キャッシュが効かない）/ same: 同一 state（warm）
      const r = await call(it, qsOf(it));
      if (i < warm) continue;
      if (r.http_error) { bad++; continue; }
      lat.push(r.latency_ms); if (r.server_latency_ms !== null) slat.push(r.server_latency_ms);
    }
    console.log(`[bench:${label}] client p50=${percentile(lat, 0.5).toFixed(0)}ms p90=${percentile(lat, 0.9).toFixed(0)}ms (ok ${lat.length}, err ${bad})`);
    return { client_ms: summarize(lat), server_ms: slat.length ? summarize(slat) : null, errors: bad };
  };
  const result = {
    model: a.model, runs, warmups: warm, passage_chars: boolq[0].state.length,
    three_questions_same_state_warm: await bench("3q-same", mkQs, false),
    three_questions_vary_state_cold: await bench("3q-vary", mkQs, true),
    noul_only_same_state_warm: await bench("noul-same", (it) => [mkQs(it)[0]], false),
  };
  writeFileSync(join(out, "latency_bench.json"), JSON.stringify(result, null, 2));
}
