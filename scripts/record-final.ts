// 最終デモ録画: Playground（成功例・日本語・曖昧→人間に回す・失敗例）→ 結果ダッシュボードを順に見せる。
// 使い方: bun scripts/record-final.ts [out.mp4=media/demo-final.mp4]
//   env: JEV_URL(既定 http://127.0.0.1:8788) / REPORT_URL(既定 http://127.0.0.1:8790) / SKIP_PLAYGROUND=1（ダッシュボードのみ・API 負荷なし）
//        FAIL_TEXT / FAIL_CAPTION（失敗例の state 文面・字幕を差し替え）。字幕は画面下部に重ねる（録画のみ。ページには残らない）。
import { chromium, type Page } from "playwright-core";
import { mkdirSync, mkdtempSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";

const JEV = process.env.JEV_URL ?? "http://127.0.0.1:8788";
const REPORT = process.env.REPORT_URL ?? "http://127.0.0.1:8790";
const ROOT = resolve(dirname(import.meta.path), "..");
const V = process.env.VERTICAL === "1"; // 縦動画（540x960 を 1080x1920 へ拡大）
const OUT = resolve(process.argv[2] ?? join(ROOT, V ? "media/demo-final-vertical.mp4" : "media/demo-final.mp4"));
mkdirSync(dirname(OUT), { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "jev-final-"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- ナレーション同期: 各シーンの保持時間を max(既定, 音声長+0.5秒) にし、シーン開始時刻（動画先頭からの秒）を SCENE_LOG に出力 ----
import { readFileSync as _rf, writeFileSync as _wf, existsSync as _ex } from "node:fs";
const DUR: Record<string, number> = process.env.VOICE_DUR && _ex(process.env.VOICE_DUR) ? JSON.parse(_rf(process.env.VOICE_DUR, "utf8")) : {};
const SCENES: { id: string; t: number }[] = [];
let T0 = 0, curEnd = 0;
const mark = (id: string) => { const now = performance.now(); curEnd = now + (DUR[id] ?? 0) * 1000 + 500; SCENES.push({ id, t: +((now - T0) / 1000).toFixed(2) }); };
const endScene = async () => { const rem = curEnd - performance.now(); if (rem > 0) await sleep(rem); };
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext(V ? { viewport: { width: 540, height: 960 }, recordVideo: { dir: tmp, size: { width: 540, height: 960 } } } : { viewport: { width: 1280, height: 800 }, recordVideo: { dir: tmp, size: { width: 1280, height: 800 } } });
const page = await ctx.newPage(); T0 = performance.now();

const caption = (p: Page, text: string) =>
  p.evaluate(([t, v]) => {
    let el = document.getElementById("__cap");
    if (!el) {
      el = document.createElement("div"); el.id = "__cap";
      el.style.cssText = v ? "position:fixed;left:14px;right:14px;bottom:28px;z-index:99;background:rgba(31,42,55,.94);color:#fff;font:700 21px/1.45 -apple-system,'Hiragino Sans',sans-serif;padding:12px 18px;border-radius:18px;text-align:center;box-shadow:0 4px 18px rgba(0,0,0,.3)" : "position:fixed;right:28px;bottom:18px;z-index:99;background:rgba(31,42,55,.92);color:#fff;font:600 17px/1.4 -apple-system,'Hiragino Sans',sans-serif;padding:9px 22px;border-radius:24px;max-width:820px;text-align:right;box-shadow:0 4px 18px rgba(0,0,0,.25)";
      document.body.append(el);
    }
    el.textContent = t; el.style.display = t ? "block" : "none";
  }, [text, V] as [string, boolean]);

// ---------- Playground ----------
const top = async () => { if (V) { await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" })); await sleep(700); } };
const toRes = async (sel: string) => { if (V) { await page.evaluate((q) => { const e = document.querySelector(q)!; window.scrollTo({ top: e.getBoundingClientRect().top + scrollY - 70, behavior: "smooth" }); }, sel); await sleep(900); } };
// 縦レイアウト用 CSS（server/playground.html は凍結のため録画側で注入）
const VCSS = `html,body{height:auto!important;overflow:auto!important} body{font-size:16px!important}
header{height:auto!important;flex-direction:column;align-items:flex-start!important;gap:4px;padding:10px 14px!important} header h1{font-size:18px!important} #meta{font-size:13px!important;text-align:left}
main{display:block!important;height:auto!important;padding:10px 12px 130px!important} .left{margin-bottom:12px;gap:10px!important} .left textarea{min-height:190px;font-size:16px!important;flex:none!important}
select,input[type=number]{font-size:16px!important} button#run{font-size:18px!important;padding:14px!important} .qlist{display:none!important}
.right{display:grid!important;grid-template-columns:1fr!important;gap:12px!important;overflow:visible!important} .card{min-height:0!important;padding:14px!important}
.card .q{font-size:16px} .card h3{font-size:14px!important} .bar{grid-template-columns:130px 1fr 48px!important;font-size:15px!important} .cols{height:120px!important} .col .pc{font-size:12px!important} .cl{font-size:12px!important}
.big{font-size:15px!important} .big b{font-size:22px!important} .gate{font-size:14px!important;padding:8px 12px!important} .empty{padding:30px 0!important}`;
const run = async (hold: number, id?: string) => {
  await page.click("#run");
  await page.waitForSelector("#out .card", { timeout: 90000 });
  await page.waitForFunction(() => !(document.getElementById("run") as HTMLButtonElement).disabled);
  await toRes("#out"); if (id) mark(id); await sleep(V ? Math.max(hold - 2000, 4500) : hold); await endScene(); await top();
};
const choose = async (i: number, cap: string) => {
  await top();
  await page.selectOption("#preset", String(i));
  // 前のプリセットの結果が新しい state の横に残らないよう、録画用に結果欄を初期表示へ戻す（サーバ側の UI ファイルは変更しない）
  await page.evaluate(() => { document.getElementById("out")!.innerHTML = '<div class="empty">プリセットを選んで「実行」を押してください。</div>'; });
  await caption(page, cap); await sleep(1800);
};
const retype = async (text: string, cap: string, append = false) => {
  await caption(page, cap); await top();
  await page.focus("#state");
  if (!append) await page.fill("#state", ""); else await page.keyboard.press("Control+End");
  await page.keyboard.type(text, { delay: 26 });
  await sleep(700);
};

if (process.env.SKIP_PLAYGROUND !== "1") {
  await page.goto(JEV); if (V) await page.addStyleTag({ content: VCSS }); mark("f00"); await sleep(2500); await endScene();
  await choose(0, "① 日本語の問い合わせチケット — 4 つの質問を一度に評価");
  await run(7000, "f01");
  await retype("件名：二重請求について\n本文：返金処理が完了したとの連絡をいただきました。迅速なご対応ありがとうございました。急ぎではないので、確認だけお願いします。", "state を書き換える → 緊急度・解約リスクの確率が動く");
  await run(7000, "f02");
  await choose(1, "② 英語のレビュー");
  await run(6000, "f03");
  await retype(" UPDATE: support replaced the left ear cup within a day and it works perfectly now. Very happy!", "追記すると sentiment の分布が変わる", true);
  await run(7000, "f04");
  await choose(2, "③ セキュリティアラートのトリアージ");
  await run(7000, "f05");
  await choose(3, "④ 曖昧な入力 — confidence が低いので「人間に回す」");
  await run(8500, "f06");
  await retype(process.env.FAIL_TEXT ?? "来週の定例は水曜15時です。田中さんは、出られる…かもしれないし、出られないかもしれません。資料は、たぶん木曜までには共有します。", process.env.FAIL_CAPTION ?? "⑤ 失敗しやすい例 — 確率が割れる／自信を持って外すこともある");
  await run(9000, "f07");
  await caption(page, "");
}

// ---------- ダッシュボード ----------
await page.goto(REPORT); mark("f08"); await sleep(2500);
const scrollTo = async (id: string, cap: string, hold: number, sid: string) => {
  await page.evaluate((i) => document.getElementById(i)!.scrollIntoView({ behavior: "smooth" }), id);
  await sleep(900); await caption(page, cap); mark(sid); await sleep(V ? Math.max(hold - 4000, 6000) : hold);
  if (V && id === "s3") { await page.evaluate(() => window.scrollBy({ top: 480, behavior: "smooth" })); await sleep(5000); }
  await endScene();
};
await caption(page, "評価結果ダッシュボード — どのモデルなら Jev 的に使えるか"); await endScene();
await scrollTo("s1", "合否判定: モデル × 構成（v1 / v2）、事前登録ゲート", 12000, "f09");
await scrollTo("s2", "モデルサイズ × タスク別正解率（Jev 公表値は別 split の参考線）", 13000, "f10");
await scrollTo("s3", "信頼性図: 素の確率 vs 単一温度の較正後", 13000, "f11");
await scrollTo("s4", "レイテンシ: warm / cold（p50）とゲート", 11000, "f12");
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
