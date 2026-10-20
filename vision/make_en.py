#!/usr/bin/env python3
"""pairs.jsonl / single.jsonl -> pairs_en.jsonl / single_en.jsonl（手訳辞書。{T}=論文の図, {O}=比較図の画像参照に実行時置換）。"""
import json, sys
from pathlib import Path
H = Path(__file__).resolve().parent
D = {
# claims
"1.0 K における共鳴周波数 f0 は、面密度 ρ が約 7 nm⁻² 以下ではほぼ一定で ρ に依存せず、それ以上の ρ では ρ とともに減少する。": "At 1.0 K, the resonance frequency f0 is nearly constant and independent of the areal density ρ below about 7 nm⁻², and decreases with ρ above that.",
"6.4 nm⁻² 以上の面密度では、0.9 K から 0.4 K 付近で降温とともに Δf0 が急激に減少する（6.0 nm⁻² 以下ではそのような急減はない）。": "At areal densities of 6.4 nm⁻² or higher, Δf0 drops sharply on cooling from about 0.9 K to 0.4 K (no such sharp drop at 6.0 nm⁻² or lower).",
"6.4〜6.8 nm⁻² ではエネルギー散逸 Q⁻¹ が 0.4〜0.9 K 付近で鋭いピークをとり、そのピーク温度は面密度が高いほど高温側にある（6.0 nm⁻² 以下ではピークがない）。": "At 6.4-6.8 nm⁻², the energy dissipation Q⁻¹ has a sharp peak around 0.4-0.9 K, and the peak temperature is higher for higher areal density (no peak at 6.0 nm⁻² or lower).",
"エネルギー散逸がピークをとる温度は、本研究（this run）では面密度の増加とともに約 0.4 K から約 0.8 K へ上昇するが、先行研究（Umemoto (2018)）では面密度によらずほぼ一定である。": "The temperature of the dissipation peak rises from about 0.4 K to about 0.8 K with increasing areal density in this study (this run), whereas it is nearly constant regardless of areal density in the previous study (Umemoto (2018)).",
"f0 の下がり幅から求めた質量の吸着 4He に対する比は、本研究（this run）では 70 % 以下であり、先行研究（Umemoto (2018)、概ね 100 % 以上）より小さい。": "The ratio of the mass estimated from the drop in f0 to the adsorbed 4He is 70 % or less in this study (this run), smaller than in the previous study (Umemoto (2018), roughly 100 % or more).",
"地震前（before earthquake）には 0.9 K 付近に f0 の急激な減少が見られたが、地震後（アニール後）の測定ではその急減が消えた。": "Before the earthquake, a sharp drop of f0 was seen around 0.9 K, but in the measurements after the earthquake (after annealing) the sharp drop disappeared.",
"再測定したエネルギー散逸 Q⁻¹ の温度依存性は、どの面密度でも鋭いピークを持たない。": "The temperature dependence of the re-measured energy dissipation Q⁻¹ has no sharp peak at any areal density.",
"面密度を増すほど Δf0 は温度によらずほぼ平行に下がる（負に大きくなる）。": "As the areal density increases, Δf0 shifts down almost in parallel regardless of temperature (becomes more negative).",
"出力電圧 V_out は駆動電圧 V_drive に比例する（原点を通る直線になる）。": "The output voltage V_out is proportional to the drive voltage V_drive (a straight line through the origin).",
"AT カット水晶振動子では 12 nm⁻² の 4He を吸着させると共鳴周波数 f0 が bare graphite より高くなり、質量増加から期待される f0 の減少は見られない。": "For the AT-cut quartz resonator, when 12 nm⁻² of 4He is adsorbed, the resonance frequency f0 becomes higher than for bare graphite, and the f0 decrease expected from the mass increase is not observed.",
# pair questions
"左の図（論文の図）と右の図の関係として最も適切なものはどれか。": "Which best describes the relationship between {T} (the thesis figure) and {O}?",
"同じ結論を示している": "They show the same conclusion",
"逆の（異なる）結論を示している": "They show the opposite (different) conclusion",
"無関係な物理量・現象の図である": "They are about unrelated physical quantities or phenomena",
"右の図の横軸の物理量はどれか。": "What physical quantity is on the horizontal axis of {O}?",
"温度 T": "Temperature T", "駆動電圧 V_drive": "Drive voltage V_drive", "磁場 H": "Magnetic field H", "面密度 ρ": "Areal density ρ",
"磁場 B": "Magnetic field B", "時間 t": "Time t", "濃度": "Concentration", "波長": "Wavelength", "pH": "pH",
"温度 (°C)": "Temperature (°C)", "駆動電圧": "Drive voltage", "電流 I": "Current I", "ひずみ ε": "Strain ε", "応力 σ": "Stress σ",
"周波数": "Frequency", "距離": "Distance", "温度": "Temperature", "時間": "Time", "放電時間": "Discharge time",
"右の図で、面密度 ρ を増やしたときの f0 の振る舞いはどれか。": "In {O}, how does f0 behave as the areal density ρ increases?",
"ρ=0 から単調に増加する": "Increases monotonically from ρ=0", "ρ=0 から単調に減少する": "Decreases monotonically from ρ=0",
"ρ によらずほぼ一定": "Nearly constant regardless of ρ", "低 ρ ではほぼ一定で、約 7 nm⁻² 以上で減少する": "Nearly constant at low ρ, decreasing above about 7 nm⁻²",
"右の図で、6.4〜6.8 nm⁻² の曲線に見られる特徴はどれか。": "In {O}, which feature is seen in the 6.4-6.8 nm⁻² curves?",
"0.4〜0.9 K 付近で降温とともに急増する": "Sharply increases on cooling around 0.4-0.9 K", "2 K 以上でのみ急減する": "Drops sharply only above 2 K",
"0.4〜0.9 K 付近で降温とともに急減する": "Drops sharply on cooling around 0.4-0.9 K", "全温度域でほぼ一定（急な変化はない）": "Nearly constant over the whole temperature range (no sharp change)",
"右の図で、Q⁻¹ のピーク温度は面密度が増すとどう変わるか。": "In {O}, how does the Q⁻¹ peak temperature change as the areal density increases?",
"低温側へずれる": "Shifts to lower temperature", "変わらない": "Does not change", "高温側へずれる": "Shifts to higher temperature", "どの曲線にもピークは無い": "No curve has a peak",
"右の図で、this run のピーク温度は ρ の増加に対してどうなっているか。": "In {O}, how does the peak temperature of this run change as ρ increases?",
"極大をもつ": "Has a maximum", "減少する": "Decreases", "増加する": "Increases", "ほぼ一定": "Nearly constant",
"右の図で、this run の値は概ねどの範囲にあるか。": "In {O}, roughly what range do the values of this run fall in?",
"100〜150 %": "100-150 %", "150〜200 %": "150-200 %", "負の値": "Negative values", "0〜70 %": "0-70 %",
"右の図で、0.5〜1 K 付近に f0 の急なくぼみ（急減）が見られるのはどの曲線か。": "In {O}, which curve shows a sharp dip (sharp drop) of f0 around 0.5-1 K?",
"before earthquake のみ": "Only before earthquake", "どの曲線にもない": "None of the curves", "after の曲線のみ": "Only the after curves", "すべての曲線": "All curves",
"右の図の Q⁻¹ に、鋭いピークは見られるか。": "Does the Q⁻¹ in {O} show a sharp peak?",
"どの面密度の曲線にもない": "In no areal-density curve", "すべての曲線にある": "In all curves", "6.4 nm⁻² 以上の曲線にある": "In the curves at 6.4 nm⁻² or higher", "bare graphite のみにある": "Only in bare graphite",
"右の図で、面密度が大きい曲線ほど Δf0 はどうなっているか。": "In {O}, how does Δf0 change for curves with larger areal density?",
"大きく（正に大きく）なる": "Becomes larger (more positive)", "小さく（負に大きく）なる": "Becomes smaller (more negative)", "温度とともに急変する": "Changes sharply with temperature", "面密度によらず同じ": "Same regardless of areal density",
"右の図の V_out と V_drive の関係はどれか。": "What is the relationship between V_out and V_drive in {O}?",
"V_drive とともに減少する": "Decreases with V_drive", "原点を通る直線（比例）": "A straight line through the origin (proportional)", "途中で飽和する": "Saturates partway", "指数関数的に増加する": "Increases exponentially",
"右の図で、12 nm⁻² の f0 は bare graphite と比べてどうか。": "In {O}, how is the f0 at 12 nm⁻² compared with bare graphite?",
"ほぼ同じ": "About the same", "高い": "Higher", "低温と高温で大小が入れ替わる": "The order swaps between low and high temperature", "低い": "Lower",
# singles
"この図の横軸の物理量はどれか。": "What physical quantity is on the horizontal axis of this figure?",
"面密度 ρ が約 7 nm⁻² 以下では、f0 はほぼ一定か。": "Is f0 nearly constant when the areal density ρ is about 7 nm⁻² or lower?",
"ρ = 30 nm⁻² 付近での f0 - 32500 (Hz) の値に最も近いのはどれか。": "Which value is closest to f0 - 32500 (Hz) near ρ = 30 nm⁻²?",
"6.8 nm⁻² の曲線は 0.5〜1 K 付近で急な変化を示すか。": "Does the 6.8 nm⁻² curve show a sharp change around 0.5-1 K?",
"6.4〜6.8 nm⁻² の曲線で Δf0 が急変する温度域はどれか。": "In the 6.4-6.8 nm⁻² curves, what temperature range shows the sharp change of Δf0?",
"急変はない": "No sharp change", "0.3〜1 K": "0.3-1 K", "2〜4 K": "2-4 K", "0.02〜0.05 K": "0.02-0.05 K",
"6.0 nm⁻² の曲線にも 0.3〜1 K で同様の急変が見られるか。": "Does the 6.0 nm⁻² curve also show a similar sharp change at 0.3-1 K?",
"6.4 nm⁻² の Q⁻¹ がピークをとる温度に最も近いのはどれか。": "Which is closest to the temperature at which Q⁻¹ peaks for 6.4 nm⁻²?",
"約 2 K": "About 2 K", "ピークはない": "There is no peak", "約 0.4 K": "About 0.4 K", "約 0.05 K": "About 0.05 K",
"ピークの高さが最も大きい曲線はどれか。": "Which curve has the highest peak?",
"6.8 nm⁻²": "6.8 nm⁻²", "6.0 nm⁻²": "6.0 nm⁻²", "bare graphite": "bare graphite", "6.4 nm⁻²": "6.4 nm⁻²",
"bare graphite の曲線に鋭いピークはあるか。": "Does the bare graphite curve have a sharp peak?",
"この図の縦軸の物理量はどれか。": "What physical quantity is on the vertical axis of this figure?",
"共鳴周波数 f0": "Resonance frequency f0", "エネルギー散逸 Q⁻¹": "Energy dissipation Q⁻¹",
"this run の値は ρ の増加とともに増加しているか。": "Do the values of this run increase with increasing ρ?",
"this run の値は概ねどの範囲にあるか。": "Roughly what range do the values of this run fall in?",
"this run の値は Umemoto (2018) の値より大きいか。": "Are the values of this run larger than those of Umemoto (2018)?",
"0.5〜1 K 付近に f0 の急なくぼみがある曲線はどれか。": "Which curve has a sharp dip of f0 around 0.5-1 K?",
"after (1st anneal)": "after (1st anneal)", "after (2nd anneal)": "after (2nd anneal)", "どれにもない": "None of them", "before earthquake": "before earthquake",
"after (1st anneal) と after (2nd anneal) の曲線はほぼ同じ振る舞いか。": "Do the after (1st anneal) and after (2nd anneal) curves behave almost the same?",
"いずれかの曲線に鋭いピークがあるか。": "Does any curve have a sharp peak?",
"温度を上げたときの Q⁻¹ の全体的な傾向はどれか。": "What is the overall trend of Q⁻¹ as temperature increases?",
"一定": "Constant", "周期的に振動する": "Oscillates periodically",
"Δf0 が最も小さい（負に大きい）曲線はどれか。": "Which curve has the smallest (most negative) Δf0?",
"12.0 nm⁻²": "12.0 nm⁻²", "32.0 nm⁻²": "32.0 nm⁻²",
"6.8 nm⁻² の曲線は 1 K 付近で急な変化を示すか。": "Does the 6.8 nm⁻² curve show a sharp change around 1 K?",
"V_out と V_drive の関係はどれか。": "What is the relationship between V_out and V_drive?",
"V_drive = 10 mV のときの V_out に最も近いのはどれか。": "Which is closest to V_out when V_drive = 10 mV?",
"約 170 mV": "About 170 mV", "約 50 mV": "About 50 mV", "約 100 mV": "About 100 mV", "約 200 mV": "About 200 mV",
"V_out が V_drive に対して飽和しているように見えるか。": "Does V_out appear to saturate with respect to V_drive?",
"低温（0.1 K 付近）で f0 が高いのはどちらか。": "Which has the higher f0 at low temperature (around 0.1 K)?",
"判別できない": "Cannot tell", "12 nm⁻²": "12 nm⁻²", "両者ほぼ同じ": "Both are about the same",
"数 K 以上の高温で、両曲線とも f0 が下がっているか。": "At high temperatures of a few K or above, does f0 decrease in both curves?",
"19.13": "19.13", "19.25": "19.25", "19.31": "19.31", "19.00": "19.00",
"減少する ": "Decreases",
}
miss = set()
def t(s):
    if s in D: return D[s]
    miss.add(s); return s
def tq(q, claim=None):
    q = dict(q)
    if q["qid"] == "same_conclusion":
        q["instructions"] = f"{{T}} (the thesis figure) shows the following conclusion: \"{t(claim)}\" Does {{O}} show the same conclusion?"
    else:
        q["instructions"] = t(q["instructions"])
    if "options" in q: q["options"] = [t(o) for o in q["options"]]
    if "gold_label" in q: q["gold_label"] = t(q["gold_label"])
    return q
def jl(p): return [json.loads(l) for l in (H / p).read_text().splitlines() if l.strip()]
with open(H / "pairs_en.jsonl", "w") as f:
    for p in jl("pairs.jsonl"):
        p = dict(p); c = p["claim"]; p["claim"] = t(c); p["questions"] = [tq(q, c) for q in p["questions"]]
        f.write(json.dumps(p, ensure_ascii=False) + "\n")
with open(H / "single_en.jsonl", "w") as f:
    for s in jl("single.jsonl"):
        s = dict(s); s["question"] = tq(dict(s["question"], qid=s["question"].get("qid", "q")))
        f.write(json.dumps(s, ensure_ascii=False) + "\n")
if miss: print("MISSING:", *sorted(miss), sep="\n"); sys.exit(1)
print("ok")
