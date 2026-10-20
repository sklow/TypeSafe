#!/usr/bin/env python3
"""Glance (:8077) 評価ハーネス。vision/run.ts と同じ条件・指標定義（eval/metrics.ts 準拠）。

使い方:
  python3 vision/run_glance.py --tag mlx2b --lang ja [--conds pair,pair-swap,single] [--limit N]
                               [--pairs vision/pairs.jsonl] [--single vision/single.jsonl] [--api http://127.0.0.1:8077]
  --lang en: pairs_en.jsonl / single_en.jsonl を使う（質問文中の {T}/{O} は論文図/比較図の画像参照に置換）。
  --dummy: vision/dummy/ のダミー画像で動作確認（結果は results/glance/_dummy に出力）。
画像参照: pair は img0/img1 の提示順（pair=論文図,比較図 / pair-swap=比較図,論文図）。質問文の「左の図（論文の図）」「右の図」を
該当 `imgN` に置換する。single は img0 のみ。
"""
import argparse, json, math, os, re, sys, time, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_ROOT = HERE / "results" / "glance"


# ---------- 指標 (eval/metrics.ts と同じ定義) ----------
def argmax(p):
    b = 0
    for i in range(1, len(p)):
        if p[i] > p[b]:
            b = i
    return b


def mean(a):
    return sum(a) / len(a) if a else float("nan")


def ece(conf, correct, bins=10):
    n = len(conf)
    cnt, sc, sa = [0] * bins, [0.0] * bins, [0.0] * bins
    for c, k in zip(conf, correct):
        b = min(bins - 1, int(math.floor(c * bins)))
        cnt[b] += 1; sc[b] += c; sa[b] += 1 if k else 0
    return sum(cnt[b] / n * abs(sa[b] / cnt[b] - sc[b] / cnt[b]) for b in range(bins) if cnt[b])


def auroc(conf, correct):
    pos = [c for c, k in zip(conf, correct) if k]
    neg = [c for c, k in zip(conf, correct) if not k]
    if not pos or not neg:
        return None
    u = sum(1.0 if p > q else 0.5 if p == q else 0.0 for p in pos for q in neg)
    return u / (len(pos) * len(neg))


def max_cov_at_prec(conf, correct, target=0.95):
    idx = sorted(range(len(conf)), key=lambda i: -conf[i])
    ok = best = 0
    for k, i in enumerate(idx):
        ok += 1 if correct[i] else 0
        boundary = k == len(idx) - 1 or conf[idx[k + 1]] != conf[i]
        if boundary and ok >= target * (k + 1) - 1e-12:
            best = k + 1
    return best / len(conf) if conf else float("nan")


def brier(probs, gold):
    return mean([sum((x - (1 if k == g else 0)) ** 2 for k, x in enumerate(p)) for p, g in zip(probs, gold)])


def percentile(a, q):
    if not a:
        return float("nan")
    s = sorted(a)
    pos = (len(s) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def r4(x):
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else round(x, 4)


def block(rs):
    ok = [r for r in rs if r.get("probs")]
    if not ok:
        return None
    conf = [max(r["probs"]) for r in ok]
    pred = [argmax(r["probs"]) for r in ok]
    corr = [p == r["gold"] for p, r in zip(pred, ok)]
    return dict(n=len(ok), n_err=len(rs) - len(ok), acc=r4(mean([1.0 if c else 0.0 for c in corr])), ece=r4(ece(conf, corr)),
                auroc=r4(auroc(conf, corr)), cov_at_prec95=r4(max_cov_at_prec(conf, corr)), mean_conf=r4(mean(conf)),
                brier=r4(brier([r["probs"] for r in ok], [r["gold"] for r in ok])))


def is_same(qid):
    return qid in ("__same", "same_conclusion")


def summarize(recs):
    ok = [r for r in recs if r.get("probs")]
    items = {}
    for r in ok:
        items[r["item"]] = r["latency_ms"]
    same = [r for r in ok if is_same(r["qid"])]
    rels = ["same", "opposite", "unrelated"]
    opp = [r for r in same if r.get("relation") == "opposite"]
    wrong = [r for r in opp if argmax(r["probs"]) == 1]
    return dict(
        all=block(ok),
        by_relation={rel: block([r for r in ok if r.get("relation") == rel]) for rel in rels},
        same_question=block(same),
        same_question_by_relation={rel: block([r for r in same if r.get("relation") == rel]) for rel in rels},
        by_type={t: block([r for r in ok if r["type"] == t and not is_same(r["qid"])]) for t in ("choice", "noul")},
        opposite_judged_same=dict(n_opposite=len(opp), n_wrong=len(wrong), rate=r4(len(wrong) / len(opp) if opp else None),
                                  mean_conf_when_wrong=r4(mean([max(r["probs"]) for r in wrong]) if wrong else None)),
        latency_ms_p50_item=r4(percentile(list(items.values()), 0.5)), latency_ms_p90_item=r4(percentile(list(items.values()), 0.9)),
        n_items=len(items), n_q=len(ok), n_err=len(recs) - len(ok))


# ---------- データ ----------
def read_jsonl(p):
    p = Path(p)
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()] if p.exists() else []


def absp(p, base):
    p = Path(p)
    return str(p if p.is_absolute() else (base / p).resolve())


def qtext(q):
    return q.get("instructions") or q.get("question")


def opt_names(o):
    if isinstance(o, list):
        return [x if isinstance(x, str) else str(x.get("key") or x.get("name") or x.get("label")) for x in o]
    return list(o.keys())


def gold_idx(q):
    g = q["gold"]
    if q["type"] == "noul":
        return 1 if (g is True or str(g).lower() in ("yes", "true")) else 0
    if isinstance(g, int) and not isinstance(g, bool):
        return g
    return opt_names(q["options"]).index(str(g))


def refs(text, t_img, o_img, lang):
    if lang == "en":
        return text.replace("{T}", f"`{t_img}`").replace("{O}", f"`{o_img}`")
    text = re.sub(r"左の図（論文の図）|左の図", f"論文の図（`{t_img}`）", text)
    return text.replace("右の図", f"比較図（`{o_img}`）")


def spec(q, text):
    if q["type"] == "noul":
        return {"type": "noul", "instructions": text}
    names = opt_names(q["options"])
    return {"type": "choice", "instructions": text, "criteria": {n: None for n in names}}


def probs_of(q, ans):
    if q["type"] == "noul":
        return [1 - ans["noul"], ans["noul"]]
    return [ans["probabilities"][n] for n in opt_names(q["options"])]


SAME_Q = {"ja": "右の図も、左の図（論文の図）が示す結論と同じ結論を示しているか。逆の結論や無関係な図であれば no。",
          "en": "Does {O} show the same conclusion as {T}? Answer no if it shows the opposite conclusion or is unrelated."}


def build(cond, pairs, singles, base, lang):
    items = []
    if cond == "single":
        for s in singles:
            q = s.get("question") or s["questions"][0]
            qs = [s["question"]] if "question" in s else s["questions"]
            items.append(dict(id=s["id"], relation=None, images=[absp(s.get("thesis_fig") or s.get("fig"), base)],
                              qs=[(dict(x, id=x.get("qid") or f"q{i}"), refs(qtext(x), "img0", "img0", lang)) for i, x in enumerate(qs)]))
        return items
    swap = cond == "pair-swap"
    for p in pairs:
        t_img, o_img = ("img1", "img0") if swap else ("img0", "img1")
        imgs = [absp(p["other_fig"], base), absp(p["thesis_fig"], base)] if swap else [absp(p["thesis_fig"], base), absp(p["other_fig"], base)]
        qs = [dict(q, id=q.get("qid") or f"q{i}") for i, q in enumerate(p["questions"])]
        if not any(is_same(q["id"]) for q in qs):
            qs.append(dict(type="noul", id="__same", instructions=SAME_Q[lang], gold=p["gold_same_conclusion"]))
        items.append(dict(id=p["id"], relation=p.get("relation"), images=imgs, qs=[(q, refs(qtext(q), t_img, o_img, lang)) for q in qs]))
    return items


def call(api, item, model="vlm"):
    questions = {q["id"]: spec(q, t) for q, t in item["qs"]}
    body = {"model": model, "state": {"images": [{"id": f"img{i}", "path": p} for i, p in enumerate(item["images"])]},
            "questions": questions, "options": {"choice_method": "independent", "calibrated": False}}
    req = urllib.request.Request(f"{api}/v1/decide", json.dumps(body).encode(), {"content-type": "application/json"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=900) as r:
        j = json.loads(r.read())
    return j, (time.perf_counter() - t0) * 1000


def run_cond(cond, items, out_file, api):
    done = {}
    for r in read_jsonl(out_file):
        if not r.get("error"):
            done.setdefault(r["item"], []).append(r)
    allr = []
    for it in items:
        if it["id"] in done:
            allr += done[it["id"]]; continue
        try:
            j, lat = call(api, it)
            recs = []
            for q, t in it["qs"]:
                p = probs_of(q, j["answers"][q["id"]])
                recs.append(dict(id=f"{cond}:{it['id']}:{q['id']}", item=it["id"], cond=cond, qid=q["id"], relation=it["relation"], type=q["type"],
                                 K=len(p), gold=gold_idx(q), probs=p, pred=argmax(p), conf=max(p), latency_ms=lat,
                                 server_ms=j.get("timing_ms", {}).get("total"), n_q=len(it["qs"]),
                                 choice=(j["answers"][q["id"]].get("choice")), prompt=t))
        except Exception as e:
            recs = [dict(id=f"{cond}:{it['id']}:{q['id']}", item=it["id"], cond=cond, qid=q["id"], relation=it["relation"], type=q["type"],
                         gold=gold_idx(q), probs=None, error=str(e)) for q, _ in it["qs"]]
            print(f"[{cond}] {it['id']} error: {e}", file=sys.stderr)
        allr += recs
        prev = [r for r in read_jsonl(out_file) if r["item"] != it["id"]]
        Path(out_file).write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in prev + recs) + "\n")
        print(f"[{cond}] {len(allr)} q", end="\r", file=sys.stderr)
    return allr


def fmt(x, d=3):
    return "-" if x is None else (f"{x:.{d}f}" if isinstance(x, float) else str(x))


def write_md(summary, path):
    md = ["# Glance 評価結果（自動生成: vision/run_glance.py）", "",
          "指標は eval/metrics.ts と同定義（ECE 10 等幅 bin、AUROC=confidence による正誤判別、cov@prec95）。noul は [P(no),P(yes)]、choice は options 順の確率。",
          "レイテンシは concurrency 1、アイテム単位（1 リクエスト＝全質問）の p50。", "",
          "## 構成 × 条件（全質問）", "",
          "| run | cond | n_q | acc | ECE | AUROC | cov@prec95 | mean_conf | latency p50 (ms/item) |", "|---|---|---|---|---|---|---|---|---|"]
    for run, v in summary.items():
        for c, s in v["conds"].items():
            a = s["all"] or {}
            md.append(f"| {run} | {c} | {a.get('n','-')} | {fmt(a.get('acc'))} | {fmt(a.get('ece'))} | {fmt(a.get('auroc'))} | {fmt(a.get('cov_at_prec95'))} | {fmt(a.get('mean_conf'))} | {fmt(s['latency_ms_p50_item'],0)} |")
    md += ["", "## relation 別正答率（全質問 / 「同じ結論か」質問のみ）", "",
           "| run | cond | same | opposite | unrelated | same-Q same | same-Q opposite | same-Q unrelated | opposite→same誤認率 |", "|---|---|---|---|---|---|---|---|---|"]
    for run, v in summary.items():
        for c, s in v["conds"].items():
            if c == "single":
                continue
            br, sq = s["by_relation"], s["same_question_by_relation"]
            g = lambda d, k: fmt((d.get(k) or {}).get("acc"))
            md.append(f"| {run} | {c} | {g(br,'same')} | {g(br,'opposite')} | {g(br,'unrelated')} | {g(sq,'same')} | {g(sq,'opposite')} | {g(sq,'unrelated')} | {fmt(s['opposite_judged_same']['rate'])} |")
    md += ["", "## 質問タイプ別 acc", "", "| run | cond | choice | noul |", "|---|---|---|---|"]
    for run, v in summary.items():
        for c, s in v["conds"].items():
            bt = s["by_type"]
            md.append(f"| {run} | {c} | {fmt((bt.get('choice') or {}).get('acc'))} (n={(bt.get('choice') or {}).get('n','-')}) | {fmt((bt.get('noul') or {}).get('acc'))} (n={(bt.get('noul') or {}).get('n','-')}) |")
    Path(path).write_text("\n".join(md) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True, help="構成名（例 mlx2b, torch4b）")
    ap.add_argument("--lang", default="ja", choices=["ja", "en"])
    ap.add_argument("--api", default="http://127.0.0.1:8077")
    ap.add_argument("--pairs"); ap.add_argument("--single")
    ap.add_argument("--conds", default="pair,pair-swap,single")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--dummy", action="store_true")
    a = ap.parse_args()
    sfx = "_en" if a.lang == "en" else ""
    if a.dummy:
        base = HERE; pf, sf = HERE / "dummy" / "pairs.jsonl", HERE / "dummy" / "single.jsonl"; out = OUT_ROOT / "_dummy"
    else:
        base = HERE; pf = Path(a.pairs or HERE / f"pairs{sfx}.jsonl"); sf = Path(a.single or HERE / f"single{sfx}.jsonl"); out = OUT_ROOT
    out.mkdir(parents=True, exist_ok=True)
    pairs, singles = read_jsonl(pf)[: a.limit], read_jsonl(sf)[: a.limit]
    summ_path = out / "summary.json"
    summary = json.loads(summ_path.read_text()) if summ_path.exists() else {}
    run = f"{a.tag}-{a.lang}"
    m = summary.setdefault(run, {"conds": {}})
    m["api"] = a.api; m["updated"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    for cond in [c for c in a.conds.split(",") if c]:
        items = build(cond, pairs, singles, base, a.lang)
        if not items:
            continue
        recs = run_cond(cond, items, out / f"{run}_{cond}.jsonl", a.api)
        m["conds"][cond] = summarize(recs)
        print(f"\n[{run}/{cond}] {json.dumps(m['conds'][cond]['all'])} p50={m['conds'][cond]['latency_ms_p50_item']}", file=sys.stderr)
        summ_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    write_md(summary, a.dummy and out / "RESULTS_glance.md" or HERE / "RESULTS_glance.md")


if __name__ == "__main__":
    main()
