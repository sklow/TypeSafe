// Playground UI を Chrome(channel:'chrome') で操作して録画し、ffmpeg で mp4(H.264, <=8MB) にする。
// 使い方: bun scripts/record-demo.ts [out.mp4=media/demo-test.mp4]   env: JEV_URL (既定 http://127.0.0.1:8788)
import { chromium } from "playwright-core";
import { mkdirSync, mkdtempSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";

const URL_ = process.env.JEV_URL ?? "http://127.0.0.1:8788";
const ROOT = resolve(dirname(import.meta.path), "..");
const OUT = resolve(process.argv[2] ?? join(ROOT, "media/demo-test.mp4"));
mkdirSync(dirname(OUT), { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "jev-rec-"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: tmp, size: { width: 1280, height: 800 } },
});
const page = await ctx.newPage();
await page.goto(URL_);
await sleep(3000);

const run = async (hold: number) => {
  await page.click("#run");
  await page.waitForSelector("#out .card", { timeout: 60000 });
  await page.waitForFunction(() => !(document.getElementById("run") as HTMLButtonElement).disabled);
  await sleep(hold);
};
const choose = async (i: number) => {
  await page.selectOption("#preset", String(i));
  await sleep(1800);
};
const retype = async (text: string, append = false) => {
  await page.focus("#state");
  if (!append) await page.fill("#state", "");
  else await page.keyboard.press("Control+End");
  await page.keyboard.type(text, { delay: 28 });
  await sleep(700);
};

// 1) 日本語チケット → 緊急の問い合わせ → 落ち着いた内容に書き換えて確率が動く様子
await choose(0);
await run(8000);
await retype("件名：二重請求について\n本文：先日の二重請求の件、返金処理が完了したとの連絡をいただきました。迅速なご対応ありがとうございました。急ぎではないので、ご確認だけお願いします。");
await run(8000);

// 2) 英語レビュー → 追記で感情が変わる
await choose(1);
await run(7000);
await retype(" UPDATE: support replaced the left ear cup within a day and it works perfectly now. Very happy!", true);
await run(8000);

// 3) セキュリティアラート
await choose(2);
await run(8000);

// 4) 曖昧な例（確率が割れる）
await choose(3);
await run(8000);

await sleep(1000);
await ctx.close();
await browser.close();

const webm = readdirSync(tmp).find((f) => f.endsWith(".webm"))!;
const src = join(tmp, webm);
for (const crf of [26, 30, 34, 38]) {
  const p = Bun.spawnSync(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-c:v", "libx264", "-preset", "slow", "-crf", String(crf),
    "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", "-an", OUT]);
  if (p.exitCode !== 0) throw new Error("ffmpeg failed: " + p.stderr.toString());
  const mb = statSync(OUT).size / 1048576;
  console.log(`crf=${crf} size=${mb.toFixed(2)}MB`);
  if (mb <= 8) break;
}
rmSync(tmp, { recursive: true, force: true });
console.log("saved", OUT);
