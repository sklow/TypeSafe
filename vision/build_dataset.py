# 図比較データセット生成: figs/other/*.png, pairs.jsonl, single.jsonl を作る
# 使い方: python build_dataset.py   (要 matplotlib, numpy)
import json, os, random
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "figs", "other")
os.makedirs(OUT, exist_ok=True)
SEED = 20261007
rng = np.random.default_rng(SEED)
RHO = r"$\rho$ (nm$^{-2}$)"
TK = "T (K)"
NM2 = r" nm$^{-2}$"
CALIB = {"t_08", "t_09", "t_10"}  # 図単位で split（同じ論文図が calib/test を跨がない）


def fig(style):
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 15})
    f, ax = plt.subplots(figsize=(6.4, 6.0), dpi=156)
    ax.tick_params(direction="in", top=True, right=True, length=6)
    for s in ax.spines.values():
        s.set_linewidth(1.4)
    return f, ax


def save(f, ax, name):
    if ax.get_xscale() == "log":  # 論文図と同じく 0.1, 1 のような素の数値表記にする
        ax.xaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{v:g}"))
    f.tight_layout()
    f.savefig(os.path.join(OUT, name + ".png"), metadata={"Software": None})
    plt.close(f)


def noise(n, s):
    return rng.normal(0, s, n)


def logT(a, b, n):
    return np.logspace(np.log10(a), np.log10(b), n)


def step(T, Tc, w, depth):
    # 降温で Tc 以下に入ると depth だけ下がる（log T 上でなめらかなステップ）
    return -depth / (1 + np.exp((np.log10(T) - np.log10(Tc)) / w))


def peak(T, Tp, w, h):
    return h * np.exp(-((np.log10(T) - np.log10(Tp)) ** 2) / (2 * w**2))


# ---------------- 各論文図の 3 種（same / opposite / unrelated） ----------------
# 各関数は relation -> 描画関数 の dict を返す。スタイル（色・マーカー・サイズ）は 3 種で共通。

def f01():
    c, m = "#1b6ca8", "^"
    def base(ax, rho, y):
        ax.plot(rho, y, m, color=c, ms=9, mec="k", mew=0.6)
        ax.text(0.05, 0.08, "1.0 K", transform=ax.transAxes)
    def same(ax):
        rho = np.sort(rng.uniform(0, 30, 22)); rho[0] = 0
        y = np.where(rho < 7, 19.31, 19.31 - 0.0078 * (rho - 7)) + noise(len(rho), 0.003)
        base(ax, rho, y); ax.set_xlim(-1, 31); ax.set_ylim(19.08, 19.35)
        ax.set_xlabel(RHO); ax.set_ylabel(r"$f_0$ - 32500 (Hz)")
    def opp(ax):
        rho = np.sort(rng.uniform(0, 30, 22)); rho[0] = 0
        y = 19.12 + 0.0063 * rho + noise(len(rho), 0.003)
        base(ax, rho, y); ax.set_xlim(-1, 31); ax.set_ylim(19.08, 19.35)
        ax.set_xlabel(RHO); ax.set_ylabel(r"$f_0$ - 32500 (Hz)")
    def unr(ax):
        H = np.sort(rng.uniform(0, 30, 22))
        y = 4.2 * np.tanh(H / 6) + noise(len(H), 0.06)
        ax.plot(H, y, m, color=c, ms=9, mec="k", mew=0.6)
        ax.text(0.65, 0.08, "300 K", transform=ax.transAxes)
        ax.set_xlim(-1, 31); ax.set_xlabel("H (kOe)"); ax.set_ylabel("M (emu/g)")
    return {"same": same, "opposite": opp, "unrelated": unr}


def f02():
    series = [("bare graphite", "#555555", None), ("2.3" + NM2, "#2ca02c", None), ("6.0" + NM2, "#17becf", None),
              ("6.4" + NM2, "#ff7f0e", 0.45), ("6.6" + NM2, "#d62728", 0.65), ("6.8" + NM2, "#9467bd", 0.85)]
    off = [0, -0.004, 0.002, -0.006, 0.0, -0.003]
    T = logT(0.03, 3, 260)
    def draw(ax, with_step):
        for (lab, col, Tc), o in zip(series, off):
            y = o + noise(len(T), 0.0012)
            if Tc and with_step:
                y = y + step(T, Tc, 0.04, 0.022)
            ax.plot(T, y, ".", color=col, ms=4, label=lab)
        ax.set_xscale("log"); ax.set_ylim(-0.06, 0.012)
        ax.set_xlabel(TK); ax.set_ylabel(r"$\Delta f_0$ (Hz)")
        ax.legend(loc="lower left", fontsize=12, markerscale=3, frameon=False, ncol=2)
    def unr(ax):
        B = np.linspace(0, 9, 200)
        for i, (lab, col) in enumerate([("0°", "#555555"), ("15°", "#2ca02c"), ("30°", "#17becf"),
                                        ("45°", "#ff7f0e"), ("60°", "#d62728"), ("75°", "#9467bd")]):
            y = 1.2 + 0.015 * (i + 1) * B**2 / 9 + noise(len(B), 0.004)
            ax.plot(B, y, ".", color=col, ms=4, label=lab)
        ax.set_xlabel("B (T)"); ax.set_ylabel(r"R ($\Omega$)")
        ax.legend(loc="upper left", fontsize=12, markerscale=3, frameon=False, ncol=2)
    return {"same": lambda ax: draw(ax, True), "opposite": lambda ax: draw(ax, False), "unrelated": unr}


def f03():
    series = [("bare graphite", "#555555", None), ("2.3" + NM2, "#2ca02c", None), ("6.0" + NM2, "#17becf", None),
              ("6.4" + NM2, "#ff7f0e", 0), ("6.6" + NM2, "#d62728", 1), ("6.8" + NM2, "#9467bd", 2)]
    T = logT(0.02, 3.5, 300)
    bg = 0.55 + 0.32 * np.log10(T / 0.02)
    def draw(ax, temps):
        for lab, col, k in series:
            y = bg + noise(len(T), 0.04)
            if k is not None:
                y = y + 0.25 * (k == 0) + peak(T, temps[k], 0.07, 2.0)
            ax.plot(T, y, ".", color=col, ms=4, label=lab)
        ax.set_xscale("log"); ax.set_ylim(0, 4.5)
        ax.set_xlabel(TK); ax.set_ylabel(r"$Q^{-1}\times 10^{6}$")
        ax.legend(loc="upper left", fontsize=12, markerscale=3, frameon=False, ncol=2)
    def unr(ax):
        lam = np.linspace(400, 800, 300)
        for i, (lab, col) in enumerate([("0 mM", "#555555"), ("1 mM", "#2ca02c"), ("2 mM", "#17becf"),
                                        ("4 mM", "#ff7f0e"), ("6 mM", "#d62728"), ("8 mM", "#9467bd")]):
            y = 0.05 + 0.12 * i * np.exp(-((lam - 560) / 35) ** 2) + noise(len(lam), 0.01)
            ax.plot(lam, y, ".", color=col, ms=4, label=lab)
        ax.set_xlabel("wavelength (nm)"); ax.set_ylabel("absorbance")
        ax.legend(loc="upper right", fontsize=12, markerscale=3, frameon=False, ncol=2)
    return {"same": lambda ax: draw(ax, [0.45, 0.62, 0.82]),
            "opposite": lambda ax: draw(ax, [0.82, 0.62, 0.45]), "unrelated": unr}


def two_series(ax, xa, ya, xb, yb, la, lb, ea=None, eb=None, loc="upper right"):
    ax.errorbar(xa, ya, yerr=ea, fmt="D", color="#2a9d8f", ms=9, mec="k", mew=0.6, capsize=4, label=la)
    ax.errorbar(xb, yb, yerr=eb, fmt="o", color="#e76f51", ms=10, mec="k", mew=0.6, capsize=4, label=lb)
    ax.legend(loc=loc, fontsize=13, frameon=False)


def f04():
    xu = np.array([6.35, 6.55, 6.8, 7.2, 7.6, 8.3, 9.2])
    yu = 0.29 + noise(len(xu), 0.035)
    xr = np.array([6.4, 6.5, 6.6, 6.7, 6.8])
    def same(ax):
        two_series(ax, xu, yu, xr, np.linspace(0.42, 0.84, 5) + noise(5, 0.015), "Umemoto (2018)", "this run")
        ax.set_xlim(6.1, 9.5); ax.set_ylim(0.1, 1.0); ax.set_xlabel(RHO); ax.set_ylabel(TK)
    def opp(ax):
        two_series(ax, xu, yu, xr, np.linspace(0.84, 0.42, 5) + noise(5, 0.015), "Umemoto (2018)", "this run")
        ax.set_xlim(6.1, 9.5); ax.set_ylim(0.1, 1.0); ax.set_xlabel(RHO); ax.set_ylabel(TK)
    def unr(ax):
        x = np.array([3, 4, 5, 6, 7, 8, 9.0])
        two_series(ax, x, 40 + 6 * x + noise(7, 2), x[:5] + 0.2, 80 - 7 * x[:5] + noise(5, 2), "catalyst A", "catalyst B", loc="upper left")
        ax.set_xlabel("pH"); ax.set_ylabel("yield (%)")
    return {"same": same, "opposite": opp, "unrelated": unr}


def f05():
    xu = np.array([6.35, 6.55, 6.8, 7.2, 7.6, 8.3, 9.2])
    xr = np.array([6.4, 6.6, 6.8])
    lo_r, lo_e = np.array([58, 42, 46.0]), np.array([12, 10, 12.0])
    hi_u, hi_e = np.array([118, 145, 140, 152, 105, 136, 128.0]), np.array([12, 18, 22, 30, 25, 8, 15.0])
    def common(ax):
        ax.set_xlim(6.1, 9.5); ax.set_ylim(0, 200); ax.set_xlabel(RHO); ax.set_ylabel(r"$\Delta$m / adsorbed He (%)")
    def same(ax):
        two_series(ax, xu, hi_u + noise(7, 4), xr, lo_r + noise(3, 3), "Umemoto (2018)", "this run", hi_e, lo_e); common(ax)
    def opp(ax):
        two_series(ax, xu, lo_r.mean() + noise(7, 6), xr, np.array([142, 128, 150.0]), "Umemoto (2018)", "this run",
                   np.full(7, 10.0), np.array([14, 12, 16.0])); common(ax)
    def unr(ax):
        t = np.array([10, 20, 30, 40, 50, 60, 70.0])
        two_series(ax, t, 30 + 1.1 * t + noise(7, 3), t[:3] + 2, 95 - 0.3 * t[:3], "salt X", "salt Y",
                   np.full(7, 5.0), np.full(3, 6.0), loc="upper left")
        ax.set_xlabel("temperature (°C)"); ax.set_ylabel("solubility (g / 100 g water)")
    return {"same": same, "opposite": opp, "unrelated": unr}


def f06():
    T = logT(0.02, 3.5, 280)
    base = 19.333 - 0.03 * (np.log10(T / 0.07)) ** 2
    base = np.where(T < 0.07, 19.333 - 0.006 * np.log10(0.07 / T) ** 2, base)
    def dip(T):
        return -0.022 * np.exp(-((np.log10(T) - np.log10(0.72)) / 0.06) ** 2) + 0.012 * np.exp(-((np.log10(T) - np.log10(0.95)) / 0.05) ** 2)
    labs = [("before earthquake", "#c1121f"), ("after (1st anneal)", "#48cae4"), ("after (2nd anneal)", "#0077b6")]
    def draw(ax, dip_idx, labels=labs, xl=TK, yl=r"$f_0$ - 32500 (Hz)"):
        for i, (lab, col) in enumerate(labels):
            y = base + 0.002 * i - 0.004 * (i == 0) + noise(len(T), 0.0012)
            if i in dip_idx:
                y = y + dip(T)
            ax.plot(T, y, ".", color=col, ms=4, label=lab)
        ax.set_xscale("log"); ax.set_ylim(19.24, 19.35); ax.set_xlabel(xl); ax.set_ylabel(yl)
        ax.legend(loc="lower left", fontsize=13, markerscale=3, frameon=False)
        ax.text(0.04, 0.3, "6.8" + NM2, transform=ax.transAxes)
    def unr(ax):
        t = np.linspace(0, 60, 280)
        for i, (lab, col) in enumerate([("run 1", "#c1121f"), ("run 2", "#48cae4"), ("run 3", "#0077b6")]):
            ax.plot(t, 12 * np.exp(-t / (14 + 3 * i)) + noise(len(t), 0.12), ".", color=col, ms=4, label=lab)
        ax.set_xlabel("t (min)"); ax.set_ylabel("I (mA)")
        ax.legend(loc="upper right", fontsize=13, markerscale=3, frameon=False)
    return {"same": lambda ax: draw(ax, [0]), "opposite": lambda ax: draw(ax, [1, 2]), "unrelated": unr}


def f07():
    series = [("bare graphite", "#555555"), ("2.0" + NM2, "#2ca02c"), ("5.0" + NM2, "#17becf"),
              ("6.4" + NM2, "#ff7f0e"), ("6.6" + NM2, "#d62728"), ("7.0" + NM2, "#9467bd")]
    T = logT(0.02, 4, 280)
    bg = 0.4 + 0.55 * np.tanh(np.log10(T / 0.02) * 1.4) + 0.35 * np.clip(np.log10(T / 1.2), 0, None) * 3
    def draw(ax, peaks):
        for i, (lab, col) in enumerate(series):
            y = bg + 0.03 * i + noise(len(T), 0.03)
            if peaks and i >= 3:
                y = y + peak(T, [0.45, 0.6, 0.8][i - 3], 0.06, 1.8)
            ax.plot(T, y, ".", color=col, ms=4, label=lab)
        ax.set_xscale("log"); ax.set_ylim(0, 3.9)
        ax.set_xlabel(TK); ax.set_ylabel(r"$Q^{-1}\times 10^{6}$")
        ax.legend(loc="upper left", fontsize=12, markerscale=3, frameon=False, ncol=2)
    def unr(ax):
        s = np.linspace(0, 400, 280)
        for i, (lab, col) in enumerate([("Al", "#555555"), ("Cu", "#2ca02c"), ("Fe", "#17becf"),
                                        ("Ti", "#ff7f0e"), ("Ni", "#d62728"), ("Zn", "#9467bd")]):
            ax.plot(s, s / (60 + 25 * i) + noise(len(s), 0.04), ".", color=col, ms=4, label=lab)
        ax.set_xlabel(r"stress $\sigma$ (MPa)"); ax.set_ylabel(r"strain $\varepsilon$ (%)")
        ax.legend(loc="upper left", fontsize=12, markerscale=3, frameon=False, ncol=2)
    return {"same": lambda ax: draw(ax, False), "opposite": lambda ax: draw(ax, True), "unrelated": unr}


def f08():
    series = [("bare graphite", "#555555", 0), ("2.3" + NM2, "#bc6c25", -0.002), ("8.0" + NM2, "#6a040f", -0.025),
              ("12.0" + NM2, "#ff006e", -0.075), ("20.6" + NM2, "#00b4d8", -0.12), ("26.0" + NM2, "#023e8a", -0.15),
              ("32.0" + NM2, "#2d6a4f", -0.19)]
    T = logT(0.03, 1.2, 160)
    def draw(ax, sign):
        for lab, col, o in series:
            ax.plot(T, sign * o + noise(len(T), 0.0025), ".", color=col, ms=4, label=lab)
        ax.set_xscale("log"); ax.set_ylim((-0.3, 0.05) if sign > 0 else (-0.05, 0.3))
        ax.set_xlabel(TK); ax.set_ylabel(r"$\Delta f_0$ (Hz)")
        ax.legend(loc="lower left" if sign > 0 else "upper left", fontsize=11, markerscale=3, frameon=False, ncol=2)
    def unr(ax):
        f = logT(20, 20000, 160)
        for i, (lab, col) in enumerate([("0 m", "#555555"), ("5 m", "#bc6c25"), ("10 m", "#6a040f"), ("20 m", "#ff006e"),
                                        ("40 m", "#00b4d8"), ("80 m", "#023e8a"), ("160 m", "#2d6a4f")]):
            ax.plot(f, 90 - 6 * i - 3 * np.log10(f / 20) + noise(len(f), 0.6), ".", color=col, ms=4, label=lab)
        ax.set_xscale("log"); ax.set_ylim(22, 95); ax.set_xlabel("frequency (Hz)"); ax.set_ylabel("sound level (dB)")
        ax.legend(loc="lower left", fontsize=11, markerscale=3, frameon=False, ncol=2)
    return {"same": lambda ax: draw(ax, 1), "opposite": lambda ax: draw(ax, -1), "unrelated": unr}


def f09():
    c = "#6a4c93"
    def draw(ax, x, y):
        xx = np.linspace(0, x.max(), 100)
        ax.plot(x, y, "s", color=c, ms=10, mec="k", mew=0.6)
        return xx
    def same(ax):
        x = np.arange(0, 8.5, 0.5); y = 17.2 * x + noise(len(x), 1.5); y[0] = 0
        xx = draw(ax, x, y); ax.plot(xx, 17.2 * xx, "-", color="#f4a261", lw=1.8)
        ax.set_xlim(-0.3, 8.5); ax.set_ylim(-5, 160); ax.set_xlabel(r"$V_\mathrm{drive}$ (mV)"); ax.set_ylabel(r"$V_\mathrm{out}$ (mV)")
    def opp(ax):
        x = np.arange(0, 8.5, 0.5); f = lambda v: 120 * (1 - np.exp(-v / 1.6)); y = f(x) + noise(len(x), 1.5); y[0] = 0
        xx = draw(ax, x, y); ax.plot(xx, f(xx), "-", color="#f4a261", lw=1.8)
        ax.set_xlim(-0.3, 8.5); ax.set_ylim(-5, 160); ax.set_xlabel(r"$V_\mathrm{drive}$ (mV)"); ax.set_ylabel(r"$V_\mathrm{out}$ (mV)")
    def unr(ax):
        x = np.arange(0, 85, 5.0); f = lambda v: 22 - 0.09 * v; y = f(x) + noise(len(x), 0.4)
        xx = draw(ax, x, y); ax.plot(xx, f(xx), "-", color="#f4a261", lw=1.8)
        ax.set_xlabel("panel temperature (°C)"); ax.set_ylabel(r"efficiency $\eta$ (%)")
    return {"same": same, "opposite": opp, "unrelated": unr}


def f10():
    T = logT(0.03, 8, 260)
    shape = -0.9 * np.clip(T - 1.3, 0, None) ** 1.7 + 1.2 * np.exp(-((np.log10(T) - 0.0) / 0.4) ** 2)
    def draw(ax, d, labels=("12" + NM2, "bare graphite"), xl=TK, yl=r"$f_0$ - 3966000 (Hz)", ylim=(705, 800)):
        ax.plot(T, 758 + d + shape + noise(len(T), 0.7), ".", color="#3a86ff", ms=5, label=labels[0])
        ax.plot(T, 758 + shape + noise(len(T), 0.7), ".", color="#fb8500", ms=5, label=labels[1])
        ax.set_xscale("log"); ax.set_ylim(*ylim); ax.set_xlabel(xl); ax.set_ylabel(yl)
        ax.legend(loc="lower left", fontsize=13, markerscale=3, frameon=False)
    def unr(ax):
        t = np.linspace(0, 10, 260)
        ax.plot(t, 4.1 - 0.05 * t - 0.6 * np.clip(t - 8, 0, None) ** 1.5 + noise(len(t), 0.01), ".", color="#3a86ff", ms=5, label="cell A")
        ax.plot(t, 3.9 - 0.07 * t - 0.6 * np.clip(t - 7, 0, None) ** 1.5 + noise(len(t), 0.01), ".", color="#fb8500", ms=5, label="cell B")
        ax.set_xlabel("discharge time (h)"); ax.set_ylabel("cell voltage (V)")
        ax.legend(loc="lower left", fontsize=13, markerscale=3, frameon=False)
    return {"same": lambda ax: draw(ax, 22), "opposite": lambda ax: draw(ax, -22), "unrelated": unr}


# ---------------- メタデータ（claim・質問） ----------------
# choice の gold は options の 0 始まり index。noul の gold は bool。
REL_Q = {"type": "choice", "instructions": "左の図（論文の図）と右の図の関係として最も適切なものはどれか。",
         "options": ["同じ結論を示している", "逆の（異なる）結論を示している", "無関係な物理量・現象の図である"]}
REL_IDX = {"same": 0, "opposite": 1, "unrelated": 2}

FIGS = {
 "t_01": dict(gen=f01, page=69, label="図5.23",
   claim="1.0 K における共鳴周波数 f0 は、面密度 ρ が約 7 nm⁻² 以下ではほぼ一定で ρ に依存せず、それ以上の ρ では ρ とともに減少する。",
   q3={"instructions": "右の図で、面密度 ρ を増やしたときの f0 の振る舞いはどれか。",
       "options": ["ρ によらずほぼ一定", "低 ρ ではほぼ一定で、約 7 nm⁻² 以上で減少する", "ρ=0 から単調に増加する", "ρ=0 から単調に減少する"],
       "same": 1, "opposite": 2},
   xq=["面密度 ρ", "温度 T", "磁場 H", "駆動電圧 V_drive"], xgold=2),
 "t_02": dict(gen=f02, page=74, label="図5.30 左",
   claim="6.4 nm⁻² 以上の面密度では、0.9 K から 0.4 K 付近で降温とともに Δf0 が急激に減少する（6.0 nm⁻² 以下ではそのような急減はない）。",
   q3={"instructions": "右の図で、6.4〜6.8 nm⁻² の曲線に見られる特徴はどれか。",
       "options": ["0.4〜0.9 K 付近で降温とともに急減する", "全温度域でほぼ一定（急な変化はない）", "0.4〜0.9 K 付近で降温とともに急増する", "2 K 以上でのみ急減する"],
       "same": 0, "opposite": 1},
   xq=["温度 T", "磁場 B", "面密度 ρ", "時間 t"], xgold=1),
 "t_03": dict(gen=f03, page=72, label="図5.26 右",
   claim="6.4〜6.8 nm⁻² ではエネルギー散逸 Q⁻¹ が 0.4〜0.9 K 付近で鋭いピークをとり、そのピーク温度は面密度が高いほど高温側にある（6.0 nm⁻² 以下ではピークがない）。",
   q3={"instructions": "右の図で、Q⁻¹ のピーク温度は面密度が増すとどう変わるか。",
       "options": ["高温側へずれる", "低温側へずれる", "変わらない", "どの曲線にもピークは無い"],
       "same": 0, "opposite": 1},
   xq=["温度 T", "波長", "面密度 ρ", "濃度"], xgold=1),
 "t_04": dict(gen=f04, page=73, label="図5.28",
   claim="エネルギー散逸がピークをとる温度は、本研究（this run）では面密度の増加とともに約 0.4 K から約 0.8 K へ上昇するが、先行研究（Umemoto (2018)）では面密度によらずほぼ一定である。",
   q3={"instructions": "右の図で、this run のピーク温度は ρ の増加に対してどうなっているか。",
       "options": ["増加する", "減少する", "ほぼ一定", "極大をもつ"], "same": 0, "opposite": 1},
   xq=["面密度 ρ", "pH", "温度 T", "時間 t"], xgold=1),
 "t_05": dict(gen=f05, page=75, label="図5.31",
   claim="f0 の下がり幅から求めた質量の吸着 4He に対する比は、本研究（this run）では 70 % 以下であり、先行研究（Umemoto (2018)、概ね 100 % 以上）より小さい。",
   q3={"instructions": "右の図で、this run の値は概ねどの範囲にあるか。",
       "options": ["0〜70 %", "100〜150 %", "150〜200 %", "負の値"], "same": 0, "opposite": 1},
   xq=["面密度 ρ", "温度 (°C)", "時間 t", "駆動電圧"], xgold=1),
 "t_06": dict(gen=f06, page=77, label="図5.34 左",
   claim="地震前（before earthquake）には 0.9 K 付近に f0 の急激な減少が見られたが、地震後（アニール後）の測定ではその急減が消えた。",
   q3={"instructions": "右の図で、0.5〜1 K 付近に f0 の急なくぼみ（急減）が見られるのはどの曲線か。",
       "options": ["before earthquake のみ", "after の曲線のみ", "すべての曲線", "どの曲線にもない"], "same": 0, "opposite": 1},
   xq=["温度 T", "時間 t", "面密度 ρ", "電流 I"], xgold=1),
 "t_07": dict(gen=f07, page=81, label="図5.39 左",
   claim="再測定したエネルギー散逸 Q⁻¹ の温度依存性は、どの面密度でも鋭いピークを持たない。",
   q3={"instructions": "右の図の Q⁻¹ に、鋭いピークは見られるか。",
       "options": ["どの面密度の曲線にもない", "6.4 nm⁻² 以上の曲線にある", "すべての曲線にある", "bare graphite のみにある"],
       "same": 0, "opposite": 1},
   xq=["温度 T", "応力 σ", "面密度 ρ", "ひずみ ε"], xgold=1),
 "t_08": dict(gen=f08, page=68, label="図5.22 左",
   claim="面密度を増すほど Δf0 は温度によらずほぼ平行に下がる（負に大きくなる）。",
   q3={"instructions": "右の図で、面密度が大きい曲線ほど Δf0 はどうなっているか。",
       "options": ["小さく（負に大きく）なる", "大きく（正に大きく）なる", "面密度によらず同じ", "温度とともに急変する"],
       "same": 0, "opposite": 1},
   xq=["温度 T", "周波数", "面密度 ρ", "距離"], xgold=1),
 "t_09": dict(gen=f09, page=55, label="図5.5 左",
   claim="出力電圧 V_out は駆動電圧 V_drive に比例する（原点を通る直線になる）。",
   q3={"instructions": "右の図の V_out と V_drive の関係はどれか。",
       "options": ["原点を通る直線（比例）", "途中で飽和する", "V_drive とともに減少する", "指数関数的に増加する"],
       "same": 0, "opposite": 1},
   xq=["駆動電圧 V_drive", "温度", "時間", "面密度 ρ"], xgold=1),
 "t_10": dict(gen=f10, page=88, label="図5.50",
   claim="AT カット水晶振動子では 12 nm⁻² の 4He を吸着させると共鳴周波数 f0 が bare graphite より高くなり、質量増加から期待される f0 の減少は見られない。",
   q3={"instructions": "右の図で、12 nm⁻² の f0 は bare graphite と比べてどうか。",
       "options": ["高い", "低い", "ほぼ同じ", "低温と高温で大小が入れ替わる"], "same": 0, "opposite": 1},
   xq=["温度 T", "放電時間", "面密度 ρ", "駆動電圧"], xgold=1),
}

SINGLE = {
 "t_01": [("choice", "この図の横軸の物理量はどれか。", ["温度 T", "面密度 ρ", "駆動電圧", "時間"], 1),
          ("noul", "面密度 ρ が約 7 nm⁻² 以下では、f0 はほぼ一定か。", None, True),
          ("choice", "ρ = 30 nm⁻² 付近での f0 - 32500 (Hz) の値に最も近いのはどれか。", ["19.31", "19.25", "19.13", "19.00"], 2)],
 "t_02": [("noul", "6.8 nm⁻² の曲線は 0.5〜1 K 付近で急な変化を示すか。", None, True),
          ("choice", "6.4〜6.8 nm⁻² の曲線で Δf0 が急変する温度域はどれか。", ["0.02〜0.05 K", "0.3〜1 K", "2〜4 K", "急変はない"], 1),
          ("noul", "6.0 nm⁻² の曲線にも 0.3〜1 K で同様の急変が見られるか。", None, False)],
 "t_03": [("choice", "6.4 nm⁻² の Q⁻¹ がピークをとる温度に最も近いのはどれか。", ["約 0.05 K", "約 0.4 K", "約 2 K", "ピークはない"], 1),
          ("choice", "ピークの高さが最も大きい曲線はどれか。", ["bare graphite", "6.0 nm⁻²", "6.4 nm⁻²", "6.8 nm⁻²"], 2),
          ("noul", "bare graphite の曲線に鋭いピークはあるか。", None, False)],
 "t_04": [("choice", "この図の縦軸の物理量はどれか。", ["温度 T", "共鳴周波数 f0", "面密度 ρ", "エネルギー散逸 Q⁻¹"], 0),
          ("noul", "this run の値は ρ の増加とともに増加しているか。", None, True)],
 "t_05": [("choice", "this run の値は概ねどの範囲にあるか。", ["0〜70 %", "100〜150 %", "150〜200 %", "負の値"], 0),
          ("noul", "this run の値は Umemoto (2018) の値より大きいか。", None, False)],
 "t_06": [("choice", "0.5〜1 K 付近に f0 の急なくぼみがある曲線はどれか。", ["before earthquake", "after (1st anneal)", "after (2nd anneal)", "どれにもない"], 0),
          ("noul", "after (1st anneal) と after (2nd anneal) の曲線はほぼ同じ振る舞いか。", None, True)],
 "t_07": [("noul", "いずれかの曲線に鋭いピークがあるか。", None, False),
          ("choice", "温度を上げたときの Q⁻¹ の全体的な傾向はどれか。", ["増加する", "減少する", "一定", "周期的に振動する"], 0)],
 "t_08": [("choice", "Δf0 が最も小さい（負に大きい）曲線はどれか。", ["bare graphite", "6.4 nm⁻²", "12.0 nm⁻²", "32.0 nm⁻²"], 3),
          ("noul", "6.8 nm⁻² の曲線は 1 K 付近で急な変化を示すか。", None, True)],
 "t_09": [("choice", "V_out と V_drive の関係はどれか。", ["原点を通る直線（比例）", "途中で飽和する", "減少する", "指数関数的に増加する"], 0),
          ("choice", "V_drive = 10 mV のときの V_out に最も近いのはどれか。", ["約 50 mV", "約 100 mV", "約 170 mV", "約 200 mV"], 2),
          ("noul", "V_out が V_drive に対して飽和しているように見えるか。", None, False)],
 "t_10": [("choice", "低温（0.1 K 付近）で f0 が高いのはどちらか。", ["12 nm⁻²", "bare graphite", "両者ほぼ同じ", "判別できない"], 0),
          ("noul", "数 K 以上の高温で、両曲線とも f0 が下がっているか。", None, True),
          ("choice", "この図の横軸の物理量はどれか。", ["温度 T", "面密度 ρ", "駆動電圧", "時間"], 0)],
}


ORNG = random.Random(SEED + 1)


def q(qid, typ, text, options, gold, shuffle=True):
    # choice の選択肢は位置バイアスを避けるためシャッフル（relation 質問は自然順のまま）
    d = {"qid": qid, "type": typ, "instructions": text}
    if typ == "choice":
        label = options[gold]
        if shuffle:
            options = options[:]; ORNG.shuffle(options)
        d["options"] = options; d["gold"] = options.index(label); d["gold_label"] = label
    else:
        d["gold"] = gold
    return d


def main():
    lrng = random.Random(SEED)
    pairs, singles = [], []
    for tid, meta in FIGS.items():
        n = tid.split("_")[1]
        split = "calib" if tid in CALIB else "test"
        draws = meta["gen"]()
        letters = ["a", "b", "c"]; lrng.shuffle(letters)  # relation と a/b/c の対応を図ごとにランダム化
        for rel, letter in zip(["same", "opposite", "unrelated"], letters):
            name = f"o_{n}_{letter}"
            f, ax = fig(None); draws[rel](ax); save(f, ax, name)
            qs = [q("same_conclusion", "noul",
                    f"左の図（論文の図）は次の結論を示している: 「{meta['claim']}」 右の図も同じ結論を示しているか。", None, rel == "same"),
                  q("relation", "choice", REL_Q["instructions"], REL_Q["options"], REL_IDX[rel], shuffle=False)]
            q3 = meta["q3"]
            if rel == "unrelated":
                qs.append(q("right_xaxis", "choice", "右の図の横軸の物理量はどれか。", meta["xq"], meta["xgold"]))
            else:
                qs.append(q("right_reading", "choice", q3["instructions"], q3["options"], q3[rel]))
            pairs.append({"id": f"pair_{n}_{letter}", "split": split, "thesis_fig": f"figs/thesis/{tid}.png",
                          "other_fig": f"figs/other/{name}.png", "thesis_src": {"pdf_page": meta["page"], "label": meta["label"]},
                          "claim": meta["claim"], "relation": rel, "gold_same_conclusion": rel == "same", "questions": qs})
        for k, (typ, text, opts, gold) in enumerate(SINGLE[tid]):
            singles.append({"id": f"single_{n}_{k}", "split": split, "fig": f"figs/thesis/{tid}.png",
                            "thesis_src": {"pdf_page": meta["page"], "label": meta["label"]},
                            "question": q(f"q{k}", typ, text, opts, gold)})
    pairs.sort(key=lambda p: p["id"])
    with open(os.path.join(HERE, "pairs.jsonl"), "w") as fp:
        for p in pairs:
            fp.write(json.dumps(p, ensure_ascii=False) + "\n")
    with open(os.path.join(HERE, "single.jsonl"), "w") as fp:
        for s in singles:
            fp.write(json.dumps(s, ensure_ascii=False) + "\n")
    print(len(pairs), "pairs,", len(singles), "single")


if __name__ == "__main__":
    main()
