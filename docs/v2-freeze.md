# server-v2 凍結記録

- 凍結時刻: 2026-10-07 00:12:03 JST
- **v2 構成（凍結）: `NOUL_STYLE=letter PERMUTATIONS=2 HEADING=document`**（見出し変更 `evidence` は含めない。コード上の既定値自体は yesno/1/document のままで、構成は環境変数で与える）
- 対象: `TypeSafeAI/server-v2/*.ts`（以後変更禁止。変更が必要なら新しいディレクトリ server-v3 等で行い、本ファイルは書き換えない）
- 既定動作（x_noul_style=yesno, x_permutations=1, x_heading=document）は server/ と確率が 1e-3 以内で一致（差は KV キャッシュ経路由来の数値ゆらぎ。argmax 同一）することを 3 問で確認済み。プロンプト文字列は既定条件で同一になるよう実装

```
7fdc55e0042be76daf39fc1dd2b5292c05269e5bca25b2ddb194817b7c99c4cc  format.ts
4c045f0d0fd5f79738f79e63982476bcf8aa7382c65950d9ae0c1b57e01736c5  index.ts
a91a49f5b394e721b1736caa039468f97770607ebedc7243eb444b64bae05af5  llama.ts
8f29ce76a9e963c8a27183118c62f10641a423eb98775580feef12225e9ab2d7  prompts.ts
c39067ee5924b827b5b1a19c00d52a30b168877a6bef6a5654e416aeb52f56cd  types.ts
ded339fe336c9ba73f2c4206a234ff370477f90239e872bbce236e35806f7d63  playground.html
```

参考: server/（v1・評価用）の現在のハッシュ
```
7fdc55e0042be76daf39fc1dd2b5292c05269e5bca25b2ddb194817b7c99c4cc  format.ts
57049a8343f0dbf44bc524e821234ebc62df27c71d517c433bf37a81d130cf85  index.ts
1cc5b9774eb6b11357b00b4795f0b0c05fc16240129efa66c425f85a43dadd49  llama.ts
c86f9ea7bb8271a6e6e68e9abee25e80e8682c3d3d823e74e516b677f6c232a3  prompts.ts
cd5ab3b2760b0b948905ede822cf078382c9e45e67cd419c0c8f80ec35cedbc7  types.ts
```

起動（v2 構成）: `cd server-v2 && PORT=8789 NOUL_STYLE=letter PERMUTATIONS=2 HEADING=document bun run index.ts`。env 既定: NOUL_STYLE / PERMUTATIONS / HEADING。

## 経緯メモ
- 2026-10-07 00:09:18〜00:11 頃、server-v2 指示の前に server/{types,prompts,index}.ts を直接編集（v2 機能の実装）。00:11 に元のバイト列へ復元済み（server/ のハッシュは上記のとおり 0.8b の run_info 記録値と一致）。稼働中 :8788 は旧コードのまま。data-agent に通知済み。
