// 公式 Jev (POST /v1/systemone) 互換のリクエスト型。docs/jev-spec.md 第1章。
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type State = string | Json[] | { [k: string]: Json };

export type Question =
  | { type: "choice"; instructions: Json; criteria: Record<string, Json> }
  | { type: "score"; instructions: Json; criteria: Json[] }
  | { type: "noul"; instructions: Json; criteria?: { true?: Json; false?: Json } };

export interface SystemOneRequest {
  state: State;
  model?: string;
  questions: Record<string, Question>;
  /** 独自拡張: 較正用の温度。{key: T} か数値（全質問共通） */
  x_temperature?: Record<string, number> | number;
}

/** 422 として返す検証エラー */
export class Invalid extends Error {}
