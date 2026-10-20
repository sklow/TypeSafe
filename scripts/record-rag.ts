// 修論 RAG デモ録画: bun scripts/record-rag.ts [out.mp4=media/demo-rag.mp4]
//  env: RAG_URL(既定 http://127.0.0.1:8792) / CHOICE_IDX(例 "0,5": 選択式で使う例題 index、既定 0,5) / OPEN_IDX(既定 "0,3": 自由記述の例題 index)
// 流れ(画像比較 VIS_IDX=同じ,逆 の index も env で指定可): 字幕で論文と仕組み → 選択式(資料なし→資料あり)×2 → 自由記述(採用される例/資料に無い例/資料なし) → 評価結果タブ
import { chromium, type Page } from "playwright-core";
import { mkdirSync, mkdtempSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";

const URL_ = process.env.RAG_URL ?? "http://127.0.0.1:8792";
const [C1, C2] = (process.env.CHOICE_IDX ?? "0,5").split(",").map(Number);
const [O1, O2] = (process.env.OPEN_IDX ?? "0,3").split(",").map(Number);
const ROOT = resolve(dirname(import.meta.path), "..");
const V = process.env.VERTICAL === "1"; // 縦動画（540x960 @2x = 1080x1920）
const OUT = resolve(process.argv[2] ?? join(ROOT, V ? "media/demo-rag-vertical.mp4" : "media/demo-rag.mp4"));
mkdirSync(dirname(OUT), { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "jev-rag-"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- 事前実行: vision は 1 回 約 1 分かかるため、録画前に API を叩いて serve(VISION_CACHE=1) に結果を保持させる ----
const [VS, VO] = (process.env.VIS_IDX ?? "2,6").split(",").map(Number); // 同じ結論の組 / 逆の結論の組（test 組の index）
const glanceUp = await fetch(process.env.GLANCE_URL ?? "http://127.0.0.1:8078/health", { signal: AbortSignal.timeout(3000) }).then(() => true, () => false);
{
  const pairs: any[] = await (await fetch(`${URL_}/api/pairs`)).json();
  const call = (id: string, engine: string) => fetch(`${URL_}/api/vision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pair_id: id, engine }) }).then((r) => r.json());
  console.log("pre-run vision ...");
  await call(pairs[VS].id, "jev"); if (glanceUp) { await call(pairs[VS].id, "both"); await call(pairs[VO].id, "both"); } else await call(pairs[VO].id, "jev");
  console.log("pre-run done; glance:", glanceUp);
}


// ---- ナレーション同期: 各シーンの保持時間を max(既定, 音声長+0.5秒) にし、シーン開始時刻（動画先頭からの秒）を SCENE_LOG に出力 ----
import { readFileSync as _rf, writeFileSync as _wf, existsSync as _ex } from "node:fs";
const DUR: Record<string, number> = process.env.VOICE_DUR && _ex(process.env.VOICE_DUR) ? JSON.parse(_rf(process.env.VOICE_DUR, "utf8")) : {};
const SCENES: { id: string; t: number }[] = [];
let T0 = 0, curEnd = 0;
const mark = (id: string) => { const now = performance.now(); curEnd = now + (DUR[id] ?? 0) * 1000 + 500; SCENES.push({ id, t: +((now - T0) / 1000).toFixed(2) }); };
const endScene = async () => { const rem = curEnd - performance.now(); if (rem > 0) await sleep(rem); };
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext(V ? { viewport: { width: 540, height: 960 }, deviceScaleFactor: 2, recordVideo: { dir: tmp, size: { width: 540, height: 960 } } } : { viewport: { width: 1280, height: 800 }, recordVideo: { dir: tmp, size: { width: 1280, height: 800 } } });
const page = await ctx.newPage(); T0 = performance.now();

const caption = (p: Page, text: string) => p.evaluate(([t, v]) => {
  let el = document.getElementById("__cap");
  if (!el) { el = document.createElement("div"); el.id = "__cap";
    el.style.cssText = v ? "position:fixed;left:14px;right:14px;bottom:28px;z-index:99;background:rgba(31,42,55,.94);color:#fff;font:700 21px/1.45 -apple-system,'Hiragino Sans',sans-serif;padding:12px 18px;border-radius:18px;text-align:center;box-shadow:0 4px 18px rgba(0,0,0,.3)" : "position:fixed;right:28px;bottom:18px;z-index:99;background:rgba(31,42,55,.92);color:#fff;font:600 17px/1.4 -apple-system,'Hiragino Sans',sans-serif;padding:9px 22px;border-radius:24px;max-width:860px;text-align:right;box-shadow:0 4px 18px rgba(0,0,0,.25)";
    document.body.append(el); }
  el.textContent = t; el.style.display = t ? "block" : "none";
}, [text, V] as [string, boolean]);
// 概要スライド（録画専用のオーバーレイ。UI ファイルは変更しない）
const slide = (p: Page, title: string, lines: string[]) => p.evaluate(([t, ls, v]) => {
  document.getElementById("__slide")?.remove();
  const d = document.createElement("div"); d.id = "__slide";
  d.style.cssText = `position:fixed;inset:0;z-index:98;background:#f4f3ef;display:flex;flex-direction:column;justify-content:center;padding:0 ${v ? 36 : 120}px;font-family:-apple-system,'Hiragino Sans',sans-serif;color:#1f2a37`;
  d.innerHTML = `<div style="font-size:${v ? 30 : 40}px;font-weight:700;line-height:1.4;margin-bottom:28px">${t}</div>` + (ls as string[]).map((x) => `<div style="font-size:${v ? 20 : 22}px;line-height:1.8;color:#2f5d62;margin-bottom:${v ? 10 : 0}px">${x}</div>`).join("");
  document.body.append(d);
}, [title, lines, V] as [string, string[], boolean]);
const unslide = (p: Page) => p.evaluate(() => document.getElementById("__slide")?.remove());

const top = async () => { if (V) { await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" })); await sleep(700); } };
const toRes = async (sel: string) => { if (V) { await page.evaluate((q) => { const e = document.querySelector(q)!; window.scrollTo({ top: e.getBoundingClientRect().top + scrollY - 70, behavior: "smooth" }); }, sel); await sleep(900); } };
const run = async (hold: number, id?: string) => {
  await page.click("#run");
  await page.waitForFunction(() => { const b = document.getElementById("run") as HTMLButtonElement; return !b.disabled && b.textContent === "実行"; }, null, { timeout: 120000 });
  await page.waitForSelector("#res .bar, #res .ans, #res .err", { timeout: 120000 });
  await toRes("#res"); if (id) mark(id); await sleep(V ? Math.max(hold - 2500, 4000) : hold); await endScene(); await top();
};
const mode = async (m: "choice" | "open") => { await top(); await page.click(`#modeSeg button[data-m="${m}"]`); await sleep(500); };
const preset = async (i: number) => {
  await top();
  await page.selectOption("#preset", String(i));
  // 前の質問の結果が新しい質問の横に残らないよう、録画用に結果欄と検索カードを初期表示へ戻す（UI ファイルは変更しない）
  await page.evaluate(() => { document.getElementById("res")!.innerHTML = '<div class="empty">「実行」を押してください。</div>'; document.getElementById("chunks")!.replaceChildren(); });
  await sleep(900);
};
const noref = async (on: boolean) => { if ((await page.isChecked("#noref")) !== on) await page.click("#noref"); await sleep(400); };

await page.goto(URL_); await sleep(1500);
await slide(page, "修士論文を知識源にした RAG ＋ Jev 型の確率つき回答", ["「graphite 上単原子層 4He 薄膜の domain wall 内における流動性の検証」（筑波大学・修士論文）", "論文の具体的な値や主張を、ローカル LLM に正しく答えさせたい"]);
mark("r00"); await sleep(V ? 4000 : 5500); await endScene();
await slide(page, "仕組み", ["① 質問 → 論文を検索（埋め込み＋BM25）して上位 3 チャンクを取り出す", "② 資料つきで LLM に渡し、答えを「確率」で受け取る（Jev 型: choice / noul）", "③ 確信度（確率）が高ければ自動採用、低ければ人間に確認"]);
mark("r01"); await sleep(V ? 5500 : 7500); await endScene();
await unslide(page);

// 選択式
await caption(page, "① 選択式 — 論文の具体値を問う（Jev の choice）");
await mode("choice"); await preset(C1); await sleep(1500);
await noref(true); await caption(page, "参考資料なし: 論文を知らないので確率が割れる／外れる"); await run(7000, "r02");
await noref(false); await caption(page, "参考資料あり: 検索した 3 チャンクを渡すと、正解に高い確率"); await run(8000, "r03");
await preset(C2); await sleep(900);
await noref(true); await caption(page, "別の質問も: 資料なし"); await run(6000, "r04");
await noref(false); await caption(page, "資料あり"); await run(7000, "r05");

// 自由記述
await caption(page, "② 自由記述 — LLM が回答を生成し、Jev が「資料に裏付けられているか」を確率で検証");
await mode("open"); await noref(false); await preset(O1); await sleep(1500);
await run(9000, "r06");
await caption(page, "③ 資料に無い質問 — 裏付けの確率が低く「人間に確認」へ");
await preset(O2); await sleep(1500); await run(9000, "r07");
await caption(page, "参考資料なしで同じ質問に答えさせると…"); await preset(O1); await noref(true); await run(8000, "r08");
await noref(false);

// 画像比較（論文の図 vs 比較図）。vision は 1 回 約 1 分かかるため、録画前に API を叩いて結果を保持させる（serve を VISION_CACHE=1 で起動しておくこと）
const runV = async (hold: number, id?: string) => {
  await top(); await toRes("#mainV .right"); await sleep(1500); await top();
  await page.click("#runV");
  await page.waitForFunction(() => { const b = document.getElementById("runV") as HTMLButtonElement; return !b.disabled && b.textContent === "実行"; }, null, { timeout: 300000 });
  await page.waitForSelector("#resV .bar, #resV .err", { timeout: 300000 });
  await toRes("#resV"); if (id) mark(id); await sleep(V ? Math.max(hold - 2500, 5000) : hold); await endScene(); await top();
};
const eng = async (e: string) => { await page.click(`#engSeg button[data-e="${e}"]`); await sleep(400); };
await caption(page, "④ 画像比較 — 論文の図と、別の図が「同じ結論か」を確率で判定");
mark("r09"); await page.click("#tabV"); await sleep(1800); await eng("jev"); await endScene();
await page.selectOption("#pair", String(VS)); await sleep(1500);
await caption(page, "同じ結論を示す図 → Jev 型は「同じ結論」に高い確率"); await runV(8000, "r10");
if (glanceUp) {
  await eng("both"); await caption(page, "同じ図を Glance にも → 同じ結論を見落とす（P(yes) が低い）"); await runV(9000, "r11");
  await page.selectOption("#pair", String(VO)); await sleep(1500);
  await caption(page, "逆の結論の図 → Jev 型は誤って「同じ」寄り、Glance は正しく「違う」"); await runV(10000, "r12");
  await caption(page, "得意・不得意が逆 — 両者が一致したときだけ自動採用、という使い方が考えられる"); mark("r13"); await sleep(6000); await endScene();
} else {
  await page.selectOption("#pair", String(VO)); await sleep(1500);
  await caption(page, "逆の結論の図 → 確率が低い／誤って「同じ」寄りになることもある"); await runV(9000);
}

// 結果
await caption(page, "評価結果 — 選択式 RAG・自由記述・画像比較");
await top(); await page.click("#tabR"); await sleep(1500);
mark("r14"); if (V) { for (const sel of ["#rAcc", "#rTab"]) { await toRes(sel); await sleep(6500); } } else await sleep(14500); await endScene();
await caption(page, "");
await sleep(500);
if (process.env.SCENE_LOG) _wf(process.env.SCENE_LOG, JSON.stringify({ total_s: +((performance.now() - T0) / 1000).toFixed(2), scenes: SCENES }, null, 1));
await ctx.close(); await browser.close();

const webm = readdirSync(tmp).find((f) => f.endsWith(".webm"))!;
const src = join(tmp, webm);
for (const crf of [26, 30, 34, 38]) {
  const p = Bun.spawnSync(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-vf", V ? "scale=1080:1920:flags=lanczos" : "scale=iw:ih", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", "-an", OUT]);
  if (p.exitCode !== 0) throw new Error("ffmpeg failed: " + p.stderr.toString());
  const mb = statSync(OUT).size / 1048576;
  console.log(`crf=${crf} size=${mb.toFixed(2)}MB`);
  if (mb <= 8) break;
}
rmSync(tmp, { recursive: true, force: true });
console.log("saved", OUT);
