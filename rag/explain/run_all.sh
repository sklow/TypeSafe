#!/usr/bin/env bash
# 9b-rag -> 9b-none -> (4B に切替) 4b-rag -> (9B に戻す) -> claude-rag（あれば）-> to_grade
set -eu
cd "$(dirname "$0")/../.."
S=scripts/start-llama.sh; M=/Users/seigo/Desktop/working/claude/TypeSafeAI/models
bun rag/explain/run.ts contexts
bun rag/explain/run.ts run --cond 9b-rag
bun rag/explain/run.ts run --cond 9b-none
$S $M/Qwen3.5-4B-Q4_K_M.gguf 8081
bun rag/explain/run.ts run --cond 4b-rag
$S $M/Qwen3.5-9B-Q4_K_M.gguf 8081
[ -s rag/explain/results/claude-rag.jsonl ] && bun rag/explain/run.ts external --cond claude-rag
bun rag/explain/run.ts togr
echo ALLDONE
