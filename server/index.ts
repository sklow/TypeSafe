// Jev 互換ローカル API サーバ。POST /v1/systemone（Bun）。仕様: docs/jev-spec.md
import { Invalid, type SystemOneRequest } from "./types";
import { SYSTEM, planChoice, planNoul, planScore, userPrefix, validateTop, type ChoicePlan } from "./prompts";
import { LLAMA_URL, aggregateLabels, firstTokenDist } from "./llama";
import { choiceAnswer, noulAnswer, normalize, scoreAnswer } from "./format";

const PORT = Number(process.env.PORT ?? 8788);
const WARM_FIRST = process.env.WARM_FIRST !== "0"; // 既定 ON。WARM_FIRST=0 で全質問を同時投入
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
  const prefix = userPrefix(req.state);
  const entries = Object.entries(req.questions);
  const T = (k: string) => {
    const t = typeof req.x_temperature === "number" ? req.x_temperature : (req.x_temperature?.[k] ?? 1);
    if (!(t > 0)) throw new Invalid(`x_temperature for ${k} must be > 0`);
    return t;
  };
  // 送信前に全質問を検証
  const plans = entries.map(([k, q]) => {
    const t = T(k);
    if (q.type === "choice") return { k, q, t, plan: planChoice(q) };
    if (q.type === "score") return { k, q, t, plan: planScore(q) };
    return { k, q, t, plan: planNoul(q) };
  });
  let model: string | undefined;
  const answers: Record<string, unknown> = {};
  const dbg: Record<string, unknown> = {};
  const runPlan = async (p: (typeof plans)[number]) => {
      if (p.q.type === "choice") {
        const r = await runChoice(u, p.plan as ChoicePlan, prefix, p.t);
        model = r.model ?? model;
        answers[p.k] = choiceAnswer((p.plan as ChoicePlan).options, r.probs);
        dbg[p.k] = r.debug;
      } else {
        const task = p.plan as { suffix: string; labels: string[] };
        const s = await probe(u, prefix, task.suffix, task.labels);
        model = s.model ?? model;
        const probs = normalize(s.raw, p.t);
        answers[p.k] = p.q.type === "score" ? scoreAnswer(p.q.criteria, probs) : noulAnswer(probs[0]);
        dbg[p.k] = stageDebug(s, p.t);
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
