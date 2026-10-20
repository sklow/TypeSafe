// 変換層: ラベル確率 → 公式 Jev 形のレスポンス（docs/jev-spec.md 第2章）。
/** 温度 T でのスケーリング: p_i ∝ p_i^(1/T) を再正規化（ログ確率を T で割る）。 */
export function normalize(raw: number[], T = 1): number[] {
  const logs = raw.map((p) => (p > 0 ? Math.log(p) / T : -Infinity));
  const m = Math.max(...logs);
  if (!isFinite(m)) return raw.map(() => 1 / raw.length); // ラベルに質量ゼロ → 一様（debug.mass_on_labels=0 で判別）
  const ex = logs.map((l) => Math.exp(l - m));
  const s = ex.reduce((a, b) => a + b, 0);
  return ex.map((e) => e / s);
}

// 公式 confidence 式（https://docs.typesafe.ai/confidence.md）
export function choiceConfidence(probs: number[]): number {
  const n = probs.length;
  return (Math.max(...probs) - 1 / n) / (1 - 1 / n);
}

export function scoreConfidence(probs: number[]): number {
  const n = probs.length;
  const m = probs.indexOf(Math.max(...probs));
  const spread = probs.reduce((a, p, i) => a + p * Math.abs(i - m), 0);
  let even = 0;
  for (let i = 0; i < n; i++) even += Math.abs(i - (n - 1) / 2);
  even /= n;
  return Math.max(0, 1 - spread / even);
}

export const choiceAnswer = (options: string[], probs: number[]) => ({
  type: "choice" as const,
  choice: options[probs.indexOf(Math.max(...probs))],
  probabilities: Object.fromEntries(options.map((o, i) => [o, probs[i]])),
  confidence: choiceConfidence(probs),
});

export const scoreAnswer = (criteria: unknown[], probs: number[]) => ({
  type: "score" as const,
  score: probs.reduce((a, p, i) => a + i * p, 0), // 添字は 0 始まり（仕様書どおり）
  legend: Object.fromEntries(criteria.map((d, i) => [String(i), d])),
  probabilities: Object.fromEntries(probs.map((p, i) => [String(i), p])),
  confidence: scoreConfidence(probs),
});

export const noulAnswer = (pYes: number) => ({ type: "noul" as const, noul: pYes });
