#!/usr/bin/env bash
# 使い方: eval/run_model.sh <model-label> stage1|stage2
#   stage1: v1(:8788) 全 6 タスク + 探索 2 種(sst5_as_choice, sst5_perm2)   -> eval/results/<label>-v1/
#   stage2: v2(:8789, NOUL_STYLE=letter PERMUTATIONS=2) 全 6 タスク / v1 の 15 択 2 タスク逆順 / latency-bench(v1,v2。最後・concurrency 1) -> <label>-v2, <label>-v1-rev
# 前提: :8081 が対象モデルで稼働、:8788 (server/)・:8789 (server-v2/ を v2 env で起動) が稼働。他エージェントに負荷をかけないよう頼んでおくこと。
set -eu
cd "$(dirname "$0")/.."
L="$1"; STAGE="$2"
R=eval/results
V2="--x-noul-style letter --x-permutations 2 --x-heading document --config v2 --server-dir server-v2"
case "$STAGE" in
  stage1)
    bun eval/run.ts --model "$L-v1" --api http://localhost:8788 --tasks all --concurrency 2 --out $R/$L-v1/
    bun eval/run.ts --model "$L-v1" --api http://localhost:8788 --tasks sst5_as_choice,sst5_perm2 --concurrency 2 --out $R/$L-v1/
    ;;
  stage2)
    bun eval/run.ts --model "$L-v2" --api http://localhost:8789 --tasks all --concurrency 2 --out $R/$L-v2/ $V2
    bun eval/run.ts --model "$L-v1-rev" --api http://localhost:8788 --tasks banking77_15,massive_ja_15 --reverse-options --concurrency 2 --out $R/$L-v1-rev/
    bun eval/run.ts --model "$L-v1" --api http://localhost:8788 --latency-bench --runs 20 --out $R/$L-v1/
    bun eval/run.ts --model "$L-v2" --api http://localhost:8789 --latency-bench --runs 20 --out $R/$L-v2/ $V2
    ;;
  v1full)  # v1 全 6 タスク + 探索 2 種 + latency-bench
    bun eval/run.ts --model "$L-v1" --api http://localhost:8788 --tasks all --concurrency 2 --out $R/$L-v1/
    bun eval/run.ts --model "$L-v1" --api http://localhost:8788 --tasks sst5_as_choice,sst5_perm2 --concurrency 2 --out $R/$L-v1/
    bun eval/run.ts --model "$L-v1" --api http://localhost:8788 --latency-bench --runs 20 --out $R/$L-v1/
    ;;
  v1fast)  # v1 全 6 タスク + latency-bench（探索なし）
    bun eval/run.ts --model "$L-v1" --api http://localhost:8788 --tasks all --concurrency 2 --out $R/$L-v1/
    bun eval/run.ts --model "$L-v1" --api http://localhost:8788 --latency-bench --runs 20 --out $R/$L-v1/
    ;;
  v2full)  # v2 全 6 タスク + latency-bench
    bun eval/run.ts --model "$L-v2" --api http://localhost:8789 --tasks all --concurrency 2 --out $R/$L-v2/ $V2
    bun eval/run.ts --model "$L-v2" --api http://localhost:8789 --latency-bench --runs 20 --out $R/$L-v2/ $V2
    ;;
esac
bun eval/summarize.ts $R/
echo "DONE $L $STAGE"
