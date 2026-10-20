// API アダプタ。サーバ仕様が変わったらこのファイルだけ直す。
// 対応プロトコル:
//   systemone : POST /v1/systemone （公式 Jev 互換: instructions/criteria、answers、x_debug）
//   decide    : POST /v1/decide    （旧独自形式: question/options/levels、results、debug）
//   auto      : /v1/systemone を探って 404 なら decide
// ハーネス内部では質問を QSpec、回答を Norm（probs はクラス index 順）に正規化する。
//   noul  -> probs = [P(no), P(yes)]  （index 1 = yes）
//   score -> probs[k] = P(level k+1)
//   choice-> probs[i] = P(options[i])

export type QType = "choice" | "score" | "noul";
export interface QSpec {
  name: string; type: QType; question: string;
  options?: string[]; levels?: number; level_labels?: string[];
}
export interface Norm {
  probs: number[] | null; pred: number | null; conf: number | null;
  expected: number | null; server_conf: number | null; mass_on_labels: number | null;
  orders: number[][] | null; flip: boolean | null; // v2 サーバ: 順序別の確率（クラス index 順に正規化済み）と argmax 不一致
  format_ok: boolean; error?: string;
}
export interface CallResult {
  answers: Record<string, Norm>; latency_ms: number; server_latency_ms: number | null; http_error?: string; server_model?: string | null; input_tokens?: number | null;
}

export type Protocol = "systemone" | "decide" | "auto";
const EPS_SUM = 1e-3;

export function argmax(p: number[]): number {
  let b = 0;
  for (let i = 1; i < p.length; i++) if (p[i] > p[b]) b = i;
  return b;
}
function K(q: QSpec): number { return q.type === "noul" ? 2 : q.type === "score" ? q.levels! : q.options!.length; }

function finish(q: QSpec, probs: number[] | null, extra: Partial<Norm>): Norm {
  const base: Norm = { probs: null, pred: null, conf: null, expected: null, server_conf: null, mass_on_labels: null, orders: null, flip: null, format_ok: false, ...extra };
  if (!probs) return { ...base, error: base.error ?? "no probs" };
  const ok = probs.length === K(q) && probs.every((x) => Number.isFinite(x) && x >= 0) && Math.abs(probs.reduce((a, b) => a + b, 0) - 1) < EPS_SUM;
  const pred = argmax(probs);
  return { ...base, probs, pred, conf: probs[pred], format_ok: ok, expected: base.expected ?? (q.type === "score" ? probs.reduce((s, x, k) => s + x * (k + 1), 0) : null) };
}
const num = (x: any): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

// ---------- リクエスト構築 ----------
function bodySystemOne(state: unknown, qs: QSpec[], temperature?: Record<string, number>) {
  const questions: Record<string, unknown> = {};
  for (const q of qs) {
    if (q.type === "choice") questions[q.name] = { type: "choice", instructions: q.question, criteria: Object.fromEntries(q.options!.map((o) => [o, null])) };
    else if (q.type === "score") questions[q.name] = { type: "score", instructions: q.question, criteria: q.level_labels ?? Array.from({ length: q.levels! }, (_, i) => `Level ${i + 1}`) };
    else questions[q.name] = { type: "noul", instructions: q.question };
  }
  return { state, questions, ...(temperature ? { x_temperature: temperature } : {}) };
}
function bodyDecide(state: unknown, qs: QSpec[], temperature?: Record<string, number>) {
  const questions: Record<string, unknown> = {};
  for (const q of qs) {
    if (q.type === "choice") questions[q.name] = { type: "choice", question: q.question, options: q.options };
    else if (q.type === "score") questions[q.name] = { type: "score", question: q.question, levels: q.levels, ...(q.level_labels ? { labels: q.level_labels } : {}) };
    else questions[q.name] = { type: "noul", question: q.question };
  }
  return { state, questions, ...(temperature ? { temperature } : {}) };
}

// ---------- レスポンス正規化 ----------
function parseSystemOne(qs: QSpec[], j: any): { answers: Record<string, Norm>; server_ms: number | null; model?: string | null } {
  const answers: Record<string, Norm> = {};
  for (const q of qs) {
    const a = j?.answers?.[q.name];
    const dbg = j?.x_debug?.questions?.[q.name];
    const mass = num(dbg?.mass_on_labels);
    // v2 サーバ: orders[].probs は正準順（choice=criteria 順、noul=[yes,no]）。noul はこちらの index 順 [no,yes] に直す
    const rawOrders: any[] | null = Array.isArray(dbg?.orders) ? dbg.orders : null;
    const orders = rawOrders && q.type !== "score" ? rawOrders.map((o) => (Array.isArray(o?.probs) ? (q.type === "noul" ? [o.probs[1], o.probs[0]] : o.probs) : null)).filter((x): x is number[] => !!x) : null;
    const flip = typeof dbg?.flip === "boolean" ? dbg.flip : null;
    const ord = { orders: orders && orders.length ? orders : null, flip };
    if (!a) { answers[q.name] = finish(q, null, { error: "missing answer", mass_on_labels: mass, ...ord }); continue; }
    if (q.type === "noul") {
      const p = num(a.noul);
      answers[q.name] = finish(q, p === null ? null : [1 - p, p], { mass_on_labels: mass, ...ord });
    } else if (q.type === "choice") {
      const pr = a.probabilities ?? {};
      const probs = q.options!.map((o) => num(pr[o]));
      answers[q.name] = finish(q, probs.every((x) => x !== null) ? (probs as number[]) : null, { server_conf: num(a.confidence), mass_on_labels: mass, ...ord, error: probs.some((x) => x === null) ? "option missing in probabilities" : undefined });
    } else {
      const pr = a.probabilities ?? {};
      const probs = Array.from({ length: q.levels! }, (_, i) => num(pr[String(i)]));
      answers[q.name] = finish(q, probs.every((x) => x !== null) ? (probs as number[]) : null, { server_conf: num(a.confidence), mass_on_labels: mass, ...ord, expected: num(a.score) === null ? null : a.score + 1 });
    }
  }
  return { answers, server_ms: num(j?.x_debug?.latency_ms), model: typeof j?.model === "string" ? j.model : null };
}
function parseDecide(qs: QSpec[], j: any): { answers: Record<string, Norm>; server_ms: number | null; model?: string | null } {
  const answers: Record<string, Norm> = {};
  for (const q of qs) {
    const a = j?.results?.[q.name];
    const mass = num(a?.debug?.mass_on_labels ?? (typeof j?.debug?.mass_on_labels === "number" ? j.debug.mass_on_labels : j?.debug?.mass_on_labels?.[q.name]));
    if (!a) { answers[q.name] = finish(q, null, { error: "missing result", mass_on_labels: mass }); continue; }
    if (q.type === "noul") { const p = num(a.p_yes); answers[q.name] = finish(q, p === null ? null : [1 - p, p], { mass_on_labels: mass, server_conf: num(a.confidence) }); }
    else answers[q.name] = finish(q, Array.isArray(a.probs) ? a.probs : null, { mass_on_labels: mass, server_conf: num(a.confidence), expected: num(a.expected) });
  }
  return { answers, server_ms: num(j?.latency_ms), model: typeof j?.model === "string" ? j.model : null };
}

// ---------- 呼び出し ----------
export class Client {
  private proto: "systemone" | "decide" | null = null;
  constructor(public api: string, public protocol: Protocol = "auto", public timeoutMs = 180_000, public ext: Record<string, unknown> = {}) {}

  async resolveProtocol(): Promise<"systemone" | "decide"> {
    if (this.proto) return this.proto;
    if (this.protocol !== "auto") return (this.proto = this.protocol);
    try {
      const r = await fetch(`${this.api}/v1/systemone`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10_000) });
      this.proto = r.status === 404 ? "decide" : "systemone";
    } catch { this.proto = "systemone"; }
    return this.proto;
  }

  async decide(state: unknown, qs: QSpec[], temperature?: Record<string, number>): Promise<CallResult> {
    const proto = await this.resolveProtocol();
    const url = `${this.api}${proto === "systemone" ? "/v1/systemone" : "/v1/decide"}`;
    const body = proto === "systemone" ? { ...bodySystemOne(state, qs, temperature), ...this.ext } : bodyDecide(state, qs, temperature); // ext = x_noul_style / x_heading / x_permutations（v2 サーバ）
    const t0 = performance.now();
    let lastErr = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) await Bun.sleep(1000 * 2 ** (attempt - 1)); // サーバ再起動などの一時的な接続失敗に備えて 1,2,4,8 秒待って再試行
      try {
        const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs) });
        const text = await r.text();
        const latency_ms = performance.now() - t0;
        if (!r.ok) { lastErr = `HTTP ${r.status}: ${text.slice(0, 300)}`; if (r.status < 500) break; continue; }
        const parsed = JSON.parse(text);
        const { answers, server_ms, model } = (proto === "systemone" ? parseSystemOne : parseDecide)(qs, parsed);
        return { answers, latency_ms, server_latency_ms: server_ms, server_model: model ?? null, input_tokens: typeof parsed?.usage?.input_tokens === "number" ? parsed.usage.input_tokens : null };
      } catch (e: any) { lastErr = String(e?.message ?? e); }
    }
    const answers: Record<string, Norm> = {};
    for (const q of qs) answers[q.name] = finish(q, null, { error: lastErr });
    return { answers, latency_ms: performance.now() - t0, server_latency_ms: null, http_error: lastErr };
  }
}

// ---------- モック（サーバ無しでハーネスを通すため）----------
function hash32(s: string): number { let h = 2166136261; for (const c of s) { h ^= c.codePointAt(0)!; h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed: number) { let a = seed; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** 正解率 ≈ 70%・過信気味の確率を返す疑似 API。gold index を内部で参照する（モック専用）。 */
export async function mockDecide(id: string, q: QSpec, goldIdx: number): Promise<CallResult> {
  const r = rng(hash32(id + q.name));
  const k = K(q);
  const right = r() < 0.7;
  let pred = goldIdx;
  if (!right) { pred = Math.floor(r() * k); if (pred === goldIdx) pred = (pred + 1) % k; }
  if (q.type === "score" && !right) pred = Math.max(0, Math.min(k - 1, goldIdx + (r() < 0.5 ? -1 : 1))); // 順序タスクは隣に外れやすい
  const logits = Array.from({ length: k }, (_, i) => (i === pred ? 3 + 3 * r() : 0.5 * r()));
  const m = Math.max(...logits), e = logits.map((x) => Math.exp(x - m)), z = e.reduce((a, b) => a + b, 0);
  const probs = e.map((x) => x / z);
  const lat = 100 + r() * 100;
  const n = finish(q, probs, { mass_on_labels: 0.97 + 0.03 * r() });
  return { answers: { [q.name]: n }, latency_ms: lat, server_latency_ms: lat - 5 };
}
