// ダッシュボードの各セクションのスクリーンショット確認用: bun scripts/shot-report.ts <outdir>
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
const out = process.argv[2] ?? "/tmp/report-shots"; mkdirSync(out, { recursive: true });
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await p.goto(process.env.REPORT_URL ?? "http://127.0.0.1:8790"); await p.waitForTimeout(1500);
for (const id of ["s1", "s2", "s3", "s4"]) {
  await p.evaluate((i) => document.getElementById(i)!.scrollIntoView({ behavior: "instant" as any }), id);
  await p.waitForTimeout(500); await p.screenshot({ path: `${out}/${id}.png` });
}
await b.close();
