// 公式 Jev (POST /v1/systemone) 互換のリクエスト型。docs/jev-spec.md 第1章。
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type State = string | Json[] | { [k: string]: Json };

export type Question =
  | { type: "choice"; instructions: Json; criteria: Record<string, Json> }
  | { type: "score"; instructions: Json; criteria: Json[] }
  | { type: "noul"; instructions: Json; criteria?: { true?: Json; false?: Json } };

export interface XImage { name: string; path?: string; data_base64?: string; mime?: string }

export interface SystemOneRequest {
  /** 独自拡張（vision）: 画像。user メッセージ先頭に name ラベル付きで順に入る。path か data_base64（data URI も可） */
  x_images?: XImage[];
  state: State;
  model?: string;
  questions: Record<string, Question>;
  /** 独自拡張: 較正用の温度。{key: T} か数値（全質問共通） */
  x_temperature?: Record<string, number> | number;
  /** 独自拡張: noul の提示形式。"yesno"(既定) = Yes/No トークン、"letter" = "A. yes: ../B. no: .." の P(A) */
  x_noul_style?: "yesno" | "letter";
  /** 独自拡張: 順序平均。1(既定) | 2（choice=正順+逆順、noul=提示順入替。score は対象外） */
  x_permutations?: 1 | 2;
  /** 独自拡張: 見出し形式。"document"(既定: <document>/QUESTION:) | "evidence"(# Evidence/# Criterion/# Options) */
  x_heading?: "document" | "evidence";
}

/** 422 として返す検証エラー */
export class Invalid extends Error {}
