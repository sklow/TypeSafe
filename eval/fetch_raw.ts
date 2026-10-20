// HF datasets-server から必要な split を全量ページング取得し、data/raw/<name>/<split>.jsonl に保存する。
// 取得データは信頼しない（生データとして保存するだけ。実行コードは含まない）。
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const H = "https://datasets-server.huggingface.co";

const SOURCES = [
  { name: "boolq", dataset: "google/boolq", config: "default", split: "validation" },
  { name: "sst5", dataset: "SetFit/sst5", config: "default", split: "test" },
  { name: "ag_news", dataset: "fancyzhx/ag_news", config: "default", split: "test" },
  { name: "banking77", dataset: "mteb/banking77", config: "default", split: "test" },
  { name: "massive_ja", dataset: "mteb/amazon_massive_intent", config: "ja", split: "test" },
  { name: "marc_ja", dataset: "yangwang825/marc-ja", config: "default", split: "validation" },
];

async function getJson(url: string): Promise<any> {
  for (let a = 0; a < 8; a++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
      console.error("status", r.status, url, (await r.text()).slice(0, 200));
      if (r.status !== 429 && r.status < 500) throw new Error(`${r.status}`);
    } catch (e) {
      console.error("retry", a, url, String(e).slice(0, 200));
      if (a === 7) throw e;
    }
    await Bun.sleep(1000 * 2 ** Math.min(a, 4));
  }
  throw new Error("unreachable");
}

for (const s of SOURCES) {
  const dir = join(ROOT, "data/raw", s.name);
  const out = join(dir, `${s.split}.jsonl`);
  if (existsSync(out)) { console.log("skip", s.name); continue; }
  mkdirSync(dir, { recursive: true });
  const q = `dataset=${encodeURIComponent(s.dataset)}&config=${s.config}&split=${s.split}`;
  const first = await getJson(`${H}/rows?${q}&offset=0&length=100`);
  const total: number = first.num_rows_total;
  const rows: any[] = first.rows.map((r: any) => r.row);
  const features = first.features;
  for (let off = 100; off < total; off += 100) {
    const j = await getJson(`${H}/rows?${q}&offset=${off}&length=100`);
    for (const r of j.rows) rows.push(r.row);
  }
  writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(join(dir, "SOURCE.json"), JSON.stringify({ ...s, num_rows: rows.length, features, fetched_at: new Date().toISOString() }, null, 1));
  console.log(s.name, rows.length, "/", total);
}
