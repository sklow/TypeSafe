// Jev 互換ローカル API サーバ。POST /v1/systemone（Bun）。仕様: docs/jev-spec.md
import { Invalid, type SystemOneRequest } from "./types";
import { SYSTEM, planChoice, planNoul, planScore, userPrefix, validateTop, type ChoicePlan, type Heading, type NoulStyle } from "./prompts";
import { LLAMA_URL, aggregateLabels, firstTokenDist } from "./llama";
import { choiceAnswer, noulAnswer, normalize, scoreAnswer } from "./format";

const PORT = Number(process.env.PORT ?? 8788);
const WARM_FIRST = process.env.WARM_FIRST !== "0"; // 既定 ON。WARM_FIRST=0 で全質問を同時投入
// 既定（リクエストの x_* で上書き可）。評価時は環境変数でサーバ既定を切り替える
const DEFAULT_NOUL_STYLE = process.env.NOUL_STYLE ?? "yesno";
const DEFAULT_PERMUTATIONS = process.env.PERMUTATIONS ?? "1";
const DEFAULT_HEADING = process.env.HEADING ?? "document";
const EXPAND_MIN = 0.02; // 2 段階 choice: 群確率がこれ以上の群だけ 2 段目を実行
const EXPAND_MAX = 3;

interface Probe {
  raw: number[];
  firstToken: string;
  cacheN?: number;
  promptN?: number;
  model?: string;
}
interface Usage { in: number; out: number }

async function probe(u: Usage, prefix: string, suffix: string, labels: string[]): Promise<Probe> {
  const d = await firstTokenDist(SYSTEM, prefix, suffix);
  u.in += d.promptTotal ?? 0; // キャッシュヒット分も含む総プロンプトトークン
  u.out += 1;
  return { raw: aggregateLabels(d.top, labels), firstToken: d.firstToken, cacheN: d.cacheN, promptN: d.promptN, model: d.model };
}

const stageDebug = (p: Probe, T: number) => {
  const mass = p.raw.reduce((a, b) => a + b, 0);
  return { mass_on_labels: mass, leak: 1 - mass, raw_probs: p.raw, first_token: p.firstToken, T, cache_n: p.cacheN };
};

/** 順序ごとの確率と argmax を含む x_debug。トップレベルは第 1 順序（後方互換）、mass_on_labels は順序平均。
 *  flip: 順序間で argmax が食い違うか（perms=2 のみ。1 のときは null）。 */
function debugOf(orders: { order: string; probs: number[]; detail: any }[], names: string[], T: number, style: string, perms: number, heading: string, type: string) {
  const first = orders[0].detail;
  const mass = orders.reduce((a, o) => a + o.detail.mass_on_labels, 0) / orders.length;
  const am = (p: number[]) => p.indexOf(Math.max(...p));
  const rows = orders.map((o) => ({
    order: o.order,
    probs: o.probs, // 正準順（choice=criteria の順、noul=[yes,no]）
    argmax: am(o.probs),
    argmax_name: names[am(o.probs)],
    mass_on_labels: o.detail.mass_on_labels,
    first_token: o.detail.first_token,
    cache_n: o.detail.cache_n,
    detail: o.detail,
  }));
  const flip = rows.length > 1 ? rows.some((r) => r.argmax !== rows[0].argmax) : null;
  return {
    ...first,
    mass_on_labels: mass,
    leak: 1 - mass,
    style: type === "noul" ? style : null,
    permutations: perms,
    heading,
    flip,
    orders: rows,
  };
}

async function runChoice(u: Usage, plan: ChoicePlan, prefix: string, T: number) {
  const s1 = await probe(u, prefix, plan.suffix, plan.labels);
  const p1 = normalize(s1.raw, T);
  if (plan.kind === "single") return { probs: p1, debug: stageDebug(s1, T), model: s1.model };
  // 2 段階: P(option) = P(group) × P(within | group)
  const groups = plan.groups!;
  const order = p1.map((p, g) => [p, g] as const).sort((a, b) => b[0] - a[0]);
  const expand = order.filter(([p], i) => i === 0 || p >= EXPAND_MIN).slice(0, EXPAND_MAX).map(([, g]) => g);
  const probs = plan.options.map(() => 0);
  const stage2: Record<string, unknown> = {};
  await Promise.all(
    groups.map(async (grp, g) => {
      if (!expand.includes(g)) {
        grp.labels.forEach((_, j) => (probs[grp.start + j] = p1[g] / grp.labels.length)); // 未展開の群は群内一様
        return;
      }
      const s2 = await probe(u, prefix, plan.stage2Suffix!(g), grp.labels);
      const p2 = normalize(s2.raw, T);
      p2.forEach((p, j) => (probs[grp.start + j] = p1[g] * p));
      stage2[String.fromCharCode(65 + g)] = stageDebug(s2, T);
    }),
  );
  return { probs, debug: { ...stageDebug(s1, T), group_probs: p1, expanded_groups: expand, stage2 }, model: s1.model };
}

async function systemOne(req: SystemOneRequest) {
  validateTop(req);
  const t0 = performance.now();
  const u: Usage = { in: 0, out: 0 };
  const style = (req.x_noul_style ?? DEFAULT_NOUL_STYLE) as NoulStyle;
  const perms = Number(req.x_permutations ?? DEFAULT_PERMUTATIONS);
  const heading = (req.x_heading ?? DEFAULT_HEADING) as Heading;
  if (style !== "yesno" && style !== "letter") throw new Invalid('x_noul_style must be "yesno" or "letter"');
  if (perms !== 1 && perms !== 2) throw new Invalid("x_permutations must be 1 or 2");
  if (heading !== "document" && heading !== "evidence") throw new Invalid('x_heading must be "document" or "evidence"');
  const prefix = userPrefix(req.state, heading);
  const entries = Object.entries(req.questions);
  const T = (k: string) => {
    const t = typeof req.x_temperature === "number" ? req.x_temperature : (req.x_temperature?.[k] ?? 1);
    if (!(t > 0)) throw new Invalid(`x_temperature for ${k} must be > 0`);
    return t;
  };
  const ORDER = ["forward", "reverse"];
  // 送信前に全質問を検証。各質問は perms 個の「順序」（プロンプト）を持つ（score は常に 1）
  const plans = entries.map(([k, q]) => {
    const t = T(k);
    if (q.type === "choice")
      return { k, q, t, plan: Array.from({ length: perms }, (_, i) => planChoice(q, heading, i === 1)) };
    if (q.type === "score") return { k, q, t, plan: [planScore(q, heading)] };
    return { k, q, t, plan: Array.from({ length: perms }, (_, i) => planNoul(q, style, heading, i === 1)) };
  });
  let model: string | undefined;
  const answers: Record<string, unknown> = {};
  const dbg: Record<string, unknown> = {};
  const mean = (rows: number[][]) => rows[0].map((_, i) => rows.reduce((a, r) => a + r[i], 0) / rows.length);
  const runPlan = async (p: (typeof plans)[number]) => {
    if (p.q.type === "choice") {
      const canon = Object.keys(p.q.criteria);
      const orders: { order: string; probs: number[]; detail: any }[] = [];
      for (let i = 0; i < p.plan.length; i++) {
        // 順序ごとに逐次実行（2 本目は state の KV キャッシュを再利用）
        const pl = p.plan[i] as ChoicePlan;
        const r = await runChoice(u, pl, prefix, p.t);
        model = r.model ?? model;
        const byName = new Map(pl.options.map((o, j) => [o, r.probs[j]]));
        orders.push({ order: ORDER[i], probs: canon.map((o) => byName.get(o)!), detail: r.debug });
      }
      const probs = mean(orders.map((o) => o.probs)); // 確率の算術平均（NOTES 参照）
      answers[p.k] = choiceAnswer(canon, probs);
      dbg[p.k] = debugOf(orders, canon, p.t, style, perms, heading, "choice");
    } else if (p.q.type === "score") {
      const task = p.plan[0] as { suffix: string; labels: string[] };
      const s = await probe(u, prefix, task.suffix, task.labels);
      model = s.model ?? model;
      answers[p.k] = scoreAnswer(p.q.criteria, normalize(s.raw, p.t));
      dbg[p.k] = { ...stageDebug(s, p.t), style: null, permutations: 1, heading };
    } else {
      const orders: { order: string; probs: number[]; detail: any }[] = [];
      for (let i = 0; i < p.plan.length; i++) {
        const pl = p.plan[i] as ReturnType<typeof planNoul>;
        const s = await probe(u, prefix, pl.suffix, pl.labels);
        model = s.model ?? model;
        const dist = normalize(s.raw, p.t);
        const yi = pl.yesIndex;
        const d = stageDebug(s, p.t);
        // raw_probs は正準順 [yes, no] に並べ直す
        orders.push({ order: ORDER[i], probs: [dist[yi], dist[1 - yi]], detail: { ...d, raw_probs: [s.raw[yi], s.raw[1 - yi]], labels: pl.labels } });
      }
      const probs = mean(orders.map((o) => o.probs));
      answers[p.k] = noulAnswer(probs[0]);
      dbg[p.k] = debugOf(orders, ["yes", "no"], p.t, style, perms, heading, "noul");
    }
  };
  // WARM_FIRST=1: 最初の質問を先に実行して state の KV をキャッシュし、残りを並列に流す
  if (WARM_FIRST && plans.length > 1) {
    await runPlan(plans[0]);
    await Promise.all(plans.slice(1).map(runPlan));
  } else await Promise.all(plans.map(runPlan));
  const ordered = Object.fromEntries(entries.map(([k]) => [k, answers[k]]));
  return {
    model: (model ?? "local").split("/").pop(),
    answers: ordered,
    usage: { input_tokens: u.in, output_tokens: u.out },
    x_debug: { latency_ms: Math.round(performance.now() - t0), questions: dbg },
  };
}

Bun.serve({
  port: PORT,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/" && req.method === "GET")
      return new Response(Bun.file(new URL("./playground.html", import.meta.url)), { headers: { "content-type": "text/html; charset=utf-8" } });
    if (url.pathname === "/health") return Response.json({ ok: true, llama: LLAMA_URL });
    if (url.pathname === "/v1/systemone" && req.method === "POST") {
      try {
        return Response.json(await systemOne((await req.json()) as SystemOneRequest));
      } catch (e: any) {
        const status = e instanceof Invalid || e instanceof SyntaxError ? 422 : 502;
        return Response.json({ error: String(e.message ?? e) }, { status });
      }
    }
    return Response.json({ error: "not found" }, { status: 404 });
  },
});
console.log(`jev-local listening on :${PORT} -> ${LLAMA_URL}`);
