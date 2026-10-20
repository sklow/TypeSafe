// 結果ダッシュボードの静的配信（読み取り専用）。port 8790。
// GET /               -> index.html
// GET /summary.json   -> eval/results/summary.json（毎回読み直す）
// GET /api/reliability?model=<dir名>  -> eval/results/<model>/*.jsonl から信頼性図用の bin を計算（プール test、素/単一T）
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const PORT = Number(process.env.PORT ?? 8790);
const RESULTS = resolve(import.meta.dir, "../eval/results");
const CORE = ["ag_news", "banking77_15", "boolq", "marc_ja_positive", "massive_ja_15", "sst5"]; // プール対象（探索タスクは除外）
const EPS = 1e-12;

const readJson = (p: string) => {
  for (let i = 0; i < 3; i++) {
    try { return JSON.parse(readFileSync(p, "utf8")); } catch { /* 書き込み中なら再試行 */ }
  }
  return null;
};

function scale(p: number[], T: number) {
  const l = p.map((x) => Math.log(Math.max(x, EPS)) / T), m = Math.max(...l);
  const e = l.map((x) => Math.exp(x - m)), z = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / z);
}

function bins(conf: number[], ok: boolean[], B = 10) {
  const cnt = Array(B).fill(0), sc = Array(B).fill(0), sa = Array(B).fill(0);
  conf.forEach((c, i) => { const b = Math.min(B - 1, Math.floor(c * B)); cnt[b]++; sc[b] += c; sa[b] += ok[i] ? 1 : 0; });
  const n = conf.length;
  const out = cnt.map((c, b) => ({ n: c, conf: c ? sc[b] / c : null, acc: c ? sa[b] / c : null }));
  const ece = out.reduce((e, x) => e + (x.n ? (x.n / n) * Math.abs(x.acc! - x.conf!) : 0), 0);
  return { bins: out, ece, n };
}

function reliability(model: string, T: number) {
  const P: number[][] = [], G: number[] = [];
  for (const t of CORE) {
    const f = join(RESULTS, model, `${t}.jsonl`);
    if (!existsSync(f)) continue;
    const byId = new Map<string, any>();
    for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) { try { const r = JSON.parse(l); byId.set(r.id, r); } catch {} }
    for (const r of byId.values()) if (r.split === "test" && Array.isArray(r.probs)) { P.push(r.probs); G.push(r.gold); }
  }
  if (!P.length) return null;
  const pred = P.map((p) => p.indexOf(Math.max(...p)));
  const ok = pred.map((p, i) => p === G[i]);
  const raw = bins(P.map((p, i) => p[pred[i]]), ok);
  const sp = P.map((p) => scale(p, T));
  const spred = sp.map((p) => p.indexOf(Math.max(...p)));
  const sok = spred.map((p, i) => p === G[i]);
  const st = bins(sp.map((p, i) => p[spred[i]]), sok);
  return { model, T, n: P.length, accuracy: ok.filter(Boolean).length / ok.length, raw, pooled_T: st };
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const u = new URL(req.url);
    const json = (x: unknown, status = 200) => Response.json(x, { status, headers: { "cache-control": "no-store" } });
    if (u.pathname === "/") return new Response(Bun.file(join(import.meta.dir, "index.html")), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    if (u.pathname === "/summary.json") {
      const s = readJson(join(RESULTS, "summary.json"));
      return s ? json(s) : json({ error: "summary.json not readable" }, 503);
    }
    if (u.pathname === "/api/reliability") {
      const model = (u.searchParams.get("model") ?? "").replace(/[^A-Za-z0-9._-]/g, "");
      const T = Number(u.searchParams.get("T") ?? 1) || 1;
      const r = model ? reliability(model, T) : null;
      return r ? json(r) : json({ error: "no data" }, 404);
    }
    return json({ error: "not found" }, 404);
  },
});
console.log(`report-ui on http://127.0.0.1:${PORT}`);
