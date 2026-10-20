// llama-server クライアント: 最初の生成トークンの top logprobs を取得し、ラベル集合へ集約する。
export const LLAMA_URL = process.env.LLAMA_URL ?? "http://127.0.0.1:8082";
const TOP_N = Number(process.env.TOP_N ?? 50);

export interface FirstTokenDist {
  /** 最初の生成トークン → 確率（softmax 全体に対する絶対確率、再正規化前） */
  top: { token: string; prob: number }[];
  firstToken: string;
  cacheN?: number;
  promptN?: number;
  promptTotal?: number;
  model?: string;
}

/** 画像 1 枚（名前付き）。dataUri は data:image/...;base64,... */
export interface LoadedImage { name: string; dataUri: string }

/** user メッセージ: 画像（「図A」等の名前ラベル付き）を先頭に、続けてテキスト。画像が無ければ従来の文字列。 */
function userContent(images: LoadedImage[], text: string) {
  if (!images.length) return text;
  const parts: any[] = [];
  for (const im of images) {
    parts.push({ type: "text", text: `[${im.name}]` });
    parts.push({ type: "image_url", image_url: { url: im.dataUri } });
  }
  parts.push({ type: "text", text });
  return parts;
}

export async function firstTokenDist(system: string, prefix: string, suffix: string, images: LoadedImage[] = []): Promise<FirstTokenDist> {
  const body = {
    model: "local",
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent(images, prefix + suffix) },
    ],
    max_tokens: 1,
    temperature: 0, // logprobs は pre-sampling で温度非依存。first_token を argmax にするため 0。温度スケーリングは format.ts 側
    logprobs: true,
    top_logprobs: TOP_N,
    cache_prompt: true,
    chat_template_kwargs: { enable_thinking: false },
  };
  const res = await fetch(`${LLAMA_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`llama-server ${res.status}: ${await res.text()}`);
  const j: any = await res.json();
  const c = j.choices?.[0]?.logprobs?.content?.[0];
  if (!c) throw new Error("no logprobs in llama-server response: " + JSON.stringify(j).slice(0, 300));
  return {
    top: (c.top_logprobs as any[]).map((t) => ({ token: t.token as string, prob: Math.exp(t.logprob as number) })),
    firstToken: c.token,
    cacheN: j.timings?.cache_n,
    promptN: j.timings?.prompt_n,
    promptTotal: j.usage?.prompt_tokens,
    model: j.model,
  };
}

/** 変種（先頭スペース・大小文字・全角半角）を合算してラベルごとの絶対確率にする。 */
export function aggregateLabels(top: FirstTokenDist["top"], labels: string[]): number[] {
  const idx = new Map(labels.map((l, i) => [l.toLowerCase(), i]));
  const out = labels.map(() => 0);
  for (const t of top) {
    const k = t.token.trim().normalize("NFKC").toLowerCase(); // 全角「Ａ」「Ｙｅｓ」等も半角に畳んで合算
    const i = idx.get(k);
    if (i !== undefined) out[i] += t.prob;
  }
  return out;
}
