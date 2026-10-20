// data/raw の生データから 6 タスク（各 200 件, calib 40 / test 160）を seed 固定でサンプリングして data/tasks/ に書く。
// gold の規約: noul = boolean (true=yes) / score = 1..levels の整数 / choice = meta.options の 0 始まりインデックス
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SEED = 20261006;
const N = 200;
const N_CALIB = 40;

const rd = (p: string): any[] =>
  readFileSync(join(ROOT, "data/raw", p), "utf8").trim().split("\n").map((l) => JSON.parse(l));

// --- seeded PRNG (mulberry32) ---
function hashStr(s: string): number {
  let h = 2166136261;
  for (const c of s) { h ^= c.codePointAt(0)!; h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** クラス均等（ラウンドロビン）で n 件選ぶ。クラス内は shuffle 済み。 */
function stratified<T>(items: T[], keyOf: (x: T) => string, n: number, rnd: () => number): T[] {
  const groups = new Map<string, T[]>();
  for (const it of shuffle(items, rnd)) { const k = keyOf(it); (groups.get(k) ?? groups.set(k, []).get(k)!).push(it); }
  const keys = shuffle([...groups.keys()].sort(), rnd);
  const out: T[] = [];
  for (let r = 0; out.length < n; r++) {
    let any = false;
    for (const k of keys) { const g = groups.get(k)!; if (r < g.length && out.length < n) { out.push(g[r]); any = true; } }
    if (!any) break;
  }
  return out;
}

type Pick = { src: string; srcIdx: number; state: string; gold: any; question?: string };

function emit(name: string, picks: Pick[], meta: any, rnd: () => number) {
  const shuffled = shuffle(picks, rnd);
  const lines = shuffled.map((p, i) => {
    const o: any = { id: `${name}-${String(i).padStart(3, "0")}`, split: i < N_CALIB ? "calib" : "test", state: p.state, gold: p.gold };
    if (p.question) o.question = p.question;
    o.src_idx = p.srcIdx;
    return o;
  });
  const dist = (rows: any[]) => {
    const d: Record<string, number> = {};
    for (const r of rows) d[String(r.gold)] = (d[String(r.gold)] ?? 0) + 1;
    return d;
  };
  const test = lines.filter((l) => l.split === "test");
  const calib = lines.filter((l) => l.split === "calib");
  const maxShare = (d: Record<string, number>, n: number) => Math.max(...Object.values(d)) / n;
  meta.name = name;
  meta.n = lines.length; meta.n_calib = calib.length; meta.n_test = test.length;
  meta.seed = SEED; meta.task_seed = SEED ^ hashStr(name);
  meta.gold_dist = { all: dist(lines), calib: dist(calib), test: dist(test) };
  meta.majority_baseline_test_acc = maxShare(meta.gold_dist.test, test.length);
  mkdirSync(join(ROOT, "data/tasks"), { recursive: true });
  writeFileSync(join(ROOT, "data/tasks", `${name}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  writeFileSync(join(ROOT, "data/tasks", `${name}.meta.json`), JSON.stringify(meta, null, 2) + "\n");
  console.log(name, meta.type, lines.length, "calib", calib.length, "test", test.length, "gold(test)", JSON.stringify(meta.gold_dist.test), "maj", meta.majority_baseline_test_acc.toFixed(3));
}
const R = (name: string) => mulberry32(SEED ^ hashStr(name));

// ---------- 1. boolq (noul, en) ----------
{
  const name = "boolq", rnd = R(name);
  const rows = rd("boolq/validation.jsonl").map((r, i) => ({ ...r, i }));
  const sel = shuffle(rows, rnd).slice(0, N);
  const cap = (q: string) => { const t = q.trim(); return t.charAt(0).toUpperCase() + t.slice(1) + (/[?.!]$/.test(t) ? "" : "?"); };
  emit(name, sel.map((r) => ({ src: name, srcIdx: r.i, state: r.passage, gold: !!r.answer, question: cap(r.question) })), {
    type: "noul", language: "en", question: "(per item: item.question holds the BoolQ question, capitalized with '?')", per_item_question: true,
    gold_encoding: "boolean (true = yes)",
    source: "google/boolq validation (Clark et al. 2019), random sample (natural distribution)", license: "CC BY-SA 3.0",
  }, rnd);
}

// ---------- 2. marc_ja (noul, ja) ----------
{
  const name = "marc_ja_positive", rnd = R(name);
  const rows = rd("marc_ja/validation.jsonl").map((r, i) => ({ ...r, i }));
  // yangwang825/marc-ja: ClassLabel names = [positive, negative], 0 = positive (目視確認済み)
  const sel = stratified(rows, (r) => String(r.label), N, rnd);
  emit(name, sel.map((r) => ({ src: name, srcIdx: r.i, state: r.text, gold: r.label === 0 })), {
    type: "noul", language: "ja", question: "このレビューは、商品に対して肯定的（好意的）な内容ですか？",
    gold_encoding: "boolean (true = positive)",
    source: "yangwang825/marc-ja validation (JGLUE MARC-ja = Multilingual Amazon Reviews Corpus の ja を positive/negative 化)。positive/negative を 100/100 で層化サンプリング（元の分布は positive 85%）",
    license: "JGLUE ラベル: CC BY-SA 4.0 / 元レビューは Amazon の MARC 利用規約（研究目的のみ。再配布・商用不可）。data/ をリポジトリ外へ配布しないこと",
  }, rnd);
}

// ---------- 3. sst5 (score, en) ----------
{
  const name = "sst5", rnd = R(name);
  const rows = rd("sst5/test.jsonl").map((r, i) => ({ ...r, i }));
  const sel = shuffle(rows, rnd).slice(0, N);
  emit(name, sel.map((r) => ({ src: name, srcIdx: r.i, state: r.text, gold: r.label + 1 })), {
    type: "score", language: "en", levels: 5,
    question: "Which level best describes the sentiment expressed in this movie review sentence?",
    level_labels: ["very negative", "negative", "neutral", "positive", "very positive"], // 順序付き criteria として API に渡す（質問文に数値スケールは書かない: サーバは 0 始まりで提示するため）
    gold_encoding: "integer 1..5 (= SetFit/sst5 label + 1)",
    source: "SetFit/sst5 test (Stanford Sentiment Treebank, Socher et al. 2013), random sample (natural distribution)",
    license: "SST: 研究用途（Stanford の SST 配布条件。HF 上は license 明記なし）",
  }, rnd);
}

// ---------- 4. ag_news (choice, en, 4) ----------
{
  const name = "ag_news", rnd = R(name);
  const rows = rd("ag_news/test.jsonl").map((r, i) => ({ ...r, i }));
  const sel = stratified(rows, (r) => String(r.label), N, rnd);
  emit(name, sel.map((r) => ({ src: name, srcIdx: r.i, state: r.text, gold: r.label })), {
    type: "choice", language: "en", question: "Which topic category does this news article belong to?",
    options: ["World", "Sports", "Business", "Science and Technology"],
    gold_encoding: "index into options (0-based)",
    source: "fancyzhx/ag_news test (Zhang et al. 2015), class-balanced sample (50 per class)", license: "非商用の研究用途（AG's corpus。HF 上は license: unknown）",
  }, rnd);
}

// ---------- 5. banking77_15 (choice, en, 15) ----------
{
  const name = "banking77_15", rnd = R(name);
  // 紛らわしいペアを含む 15 intent を固定（original label_text -> readable）
  const MAP: [string, string][] = [
    ["card_arrival", "Card arrival (where is my new card)"],
    ["card_delivery_estimate", "Card delivery estimate"],
    ["activate_my_card", "Activate my card"],
    ["lost_or_stolen_card", "Lost or stolen card"],
    ["card_not_working", "Card not working"],
    ["pending_card_payment", "Pending card payment"],
    ["declined_card_payment", "Declined card payment"],
    ["exchange_rate", "Exchange rate"],
    ["exchange_charge", "Exchange charge"],
    ["top_up_failed", "Top-up failed"],
    ["pending_top_up", "Pending top-up"],
    ["cancel_transfer", "Cancel transfer"],
    ["transfer_not_received_by_recipient", "Transfer not received by recipient"],
    ["request_refund", "Request refund"],
    ["change_pin", "Change PIN"],
  ];
  const idx = new Map(MAP.map(([k], i) => [k, i]));
  const rows = rd("banking77/test.jsonl").map((r, i) => ({ ...r, i })).filter((r) => idx.has(r.label_text));
  const sel = stratified(rows, (r) => r.label_text, N, rnd);
  emit(name, sel.map((r) => ({ src: name, srcIdx: r.i, state: r.text, gold: idx.get(r.label_text)! })), {
    type: "choice", language: "en", question: "Which intent best describes this customer message to a banking app?",
    options: MAP.map(([, v]) => v), original_labels: MAP.map(([k]) => k),
    gold_encoding: "index into options (0-based)",
    source: "mteb/banking77 test (PolyAI Banking77, Casanueva et al. 2020), 15 fixed intents incl. confusable pairs, class-balanced (13-14 per class)", license: "CC BY 4.0（元 PolyAI/banking77）。mteb ミラーは MIT 表記",
  }, rnd);
}

// ---------- 6. massive_ja_15 (choice, ja, 15) ----------
{
  const name = "massive_ja_15", rnd = R(name);
  const MAP: [string, string][] = [
    ["alarm_set", "アラームを設定する"],
    ["alarm_query", "アラームの設定内容を確認する"],
    ["alarm_remove", "アラームを削除する"],
    ["calendar_set", "カレンダーに予定を追加する"],
    ["calendar_query", "カレンダーの予定を確認する"],
    ["weather_query", "天気を尋ねる"],
    ["play_music", "音楽を再生する"],
    ["music_query", "曲やアーティストについて尋ねる"],
    ["news_query", "ニュースを尋ねる"],
    ["email_sendemail", "メールを送る"],
    ["email_query", "メールを確認する"],
    ["lists_createoradd", "リストを作成・項目を追加する"],
    ["takeaway_order", "テイクアウトを注文する"],
    ["transport_query", "交通手段・経路を尋ねる"],
    ["datetime_query", "日付や時刻を尋ねる"],
  ];
  const idx = new Map(MAP.map(([k], i) => [k, i]));
  const rows = rd("massive_ja/test.jsonl").map((r, i) => ({ ...r, i })).filter((r) => idx.has(r.label_text));
  const sel = stratified(rows, (r) => r.label_text, N, rnd);
  emit(name, sel.map((r) => ({ src: name, srcIdx: r.i, state: r.text, gold: idx.get(r.label_text)! })), {
    type: "choice", language: "ja", question: "このユーザー発話は、音声アシスタントに対するどの依頼（intent）ですか？",
    options: MAP.map(([, v]) => v), original_labels: MAP.map(([k]) => k),
    gold_encoding: "index into options (0-based)",
    source: "mteb/amazon_massive_intent config=ja test (Amazon MASSIVE, FitzGerald et al. 2022), 15 fixed intents incl. confusable pairs, class-balanced (13-14 per class)", license: "CC BY 4.0（MASSIVE。mteb ミラーは apache-2.0 表記）",
  }, rnd);
}

// ---------- 探索的（事前登録外・gates 対象外）: sst5 を choice 型（A-E レター）として投げる派生タスク ----------
{
  const name = "sst5_as_choice", rnd = R(name);
  const base = readFileSync(join(ROOT, "data/tasks/sst5.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const sm = JSON.parse(readFileSync(join(ROOT, "data/tasks/sst5.meta.json"), "utf8"));
  // sst5 と同一アイテム・同一 split（id のみ付け替え）。gold = level-1 (options の index)
  const lines = base.map((o: any) => ({ ...o, id: o.id.replace("sst5-", `${name}-`), gold: o.gold - 1 }));
  const dist = (rows: any[]) => { const d: Record<string, number> = {}; for (const r of rows) d[String(r.gold)] = (d[String(r.gold)] ?? 0) + 1; return d; };
  const test = lines.filter((l: any) => l.split === "test"), calib = lines.filter((l: any) => l.split === "calib");
  const meta = {
    name, type: "choice", language: "en", question: sm.question, options: sm.level_labels, ordinal: true, exploratory: true, derived_from: "sst5", presentation: "choice・レター A-E",
    gold_encoding: "index into options (0-based) = sst5 level - 1。ordinal=true: 選択肢は順序付き（off-by-one 等を算出）",
    note: "探索的（事前登録外）。score の数字ラベル(0..4)方式の弱さか、モデルの弱さかの切り分け用。gates・プール較正の対象外",
    source: sm.source, license: sm.license,
    n: lines.length, n_calib: calib.length, n_test: test.length, seed: SEED, task_seed: SEED ^ hashStr(name),
    gold_dist: { all: dist(lines), calib: dist(calib), test: dist(test) },
    majority_baseline_test_acc: Math.max(...Object.values(dist(test))) / test.length,
  };
  writeFileSync(join(ROOT, "data/tasks", `${name}.jsonl`), lines.map((l: any) => JSON.stringify(l)).join("\n") + "\n");
  writeFileSync(join(ROOT, "data/tasks", `${name}.meta.json`), JSON.stringify(meta, null, 2) + "\n");
  void rnd;
  console.log(name, "choice(exploratory)", lines.length, "gold(test)", JSON.stringify(meta.gold_dist.test));
}

// ---------- 探索的: sst5 の score を「criteria 正順 + 逆順」の 2 回提示（ハーネス側で 2 回投げ、レベル順に戻して算術平均）----------
{
  const name = "sst5_perm2";
  const base = readFileSync(join(ROOT, "data/tasks/sst5.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const sm = JSON.parse(readFileSync(join(ROOT, "data/tasks/sst5.meta.json"), "utf8"));
  const lines = base.map((o: any) => ({ ...o, id: o.id.replace("sst5-", `${name}-`) })); // gold は sst5 と同じ（level 1..5）
  const dist = (rows: any[]) => { const d: Record<string, number> = {}; for (const r of rows) d[String(r.gold)] = (d[String(r.gold)] ?? 0) + 1; return d; };
  const test = lines.filter((l: any) => l.split === "test"), calib = lines.filter((l: any) => l.split === "calib");
  const meta = {
    ...sm, name, exploratory: true, derived_from: "sst5", harness_perm2: true, presentation: "score・数字 0..4、正順+逆順の平均（ハーネス側 2 回呼び出し）",
    note: "探索的（事前登録外）。criteria を正順と逆順で 2 回提示し、レベル順に戻して確率を算術平均（orders に各順序を保存＝対数平均・flip rate も算出可）。gates・プール較正の対象外。レイテンシは 2 回分の合計",
    n: lines.length, n_calib: calib.length, n_test: test.length, gold_dist: { all: dist(lines), calib: dist(calib), test: dist(test) },
  };
  writeFileSync(join(ROOT, "data/tasks", `${name}.jsonl`), lines.map((l: any) => JSON.stringify(l)).join("\n") + "\n");
  writeFileSync(join(ROOT, "data/tasks", `${name}.meta.json`), JSON.stringify(meta, null, 2) + "\n");
  console.log(name, "score(exploratory)", lines.length);
}
