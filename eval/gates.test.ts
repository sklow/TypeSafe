import { test, expect } from "bun:test";
import { judge, TASKS } from "./gates";

// 全ゲートを通過する合成 TaskEval（必要な項目のみ）
const blk = (o: any = {}): any => ({ accuracy: 0.95, ece: 0.03, auroc: 0.9, max_cov_at_prec_95: 0.8, score: { acc_off_by_one: 0.95 }, ci: { ece: [0.01, 0.08] }, ...o });
const te = (o: any = {}, oT: any = {}): any => ({ n_total: 200, n_err: 0, n_format_violation: 0, mass_mean: 0.99, test: blk(o), test_Tpool: blk({ ...o, ...oT }) });
const allGood = () => Object.fromEntries(TASKS.map((t) => [t, te()]));
const pooledGood = (rawEce = 0.03, tEce = 0.03): any => ({ raw: blk({ ece: rawEce }), pooled_T: blk({ ece: tEce }) });
const benchGood = (l1 = 100, l3 = 400): any => ({ noul_only_same_state_warm: { client_ms: { p50: l1 } }, three_questions_same_state_warm: { client_ms: { p50: l3 } } });

test("全ゲート通過 -> A", () => {
  const j = judge(allGood(), pooledGood(), benchGood());
  expect(j.verdict).toBe("A");
});
test("素の ECE だけ落ちて単一 T 後に通る -> B", () => {
  const ev = Object.fromEntries(TASKS.map((t) => [t, te({ ci: { ece: [0.1, 0.2] } }, { ci: { ece: [0.01, 0.08] } })]));
  const j = judge(ev, pooledGood(0.12, 0.04), benchGood());
  expect(j.g3_raw.pass).toBe(false); expect(j.g3_T.pass).toBe(true); expect(j.verdict).toBe("B");
});
test("精度ゲート不通過 -> C（sst5 の off-by-one 単独でも落ちる）", () => {
  const ev = allGood(); ev.sst5 = te({ score: { acc_off_by_one: 0.8 } });
  const j = judge(ev, pooledGood(), benchGood());
  expect(j.g2.pass).toBe(false); expect(j.g2.fails[0]).toContain("sst5"); expect(j.verdict).toBe("C");
});
test("レイテンシ超過 -> C、境界値は通過", () => {
  expect(judge(allGood(), pooledGood(), benchGood(501, 400)).verdict).toBe("C");
  expect(judge(allGood(), pooledGood(), benchGood(500, 1000)).verdict).toBe("A");
  expect(judge(allGood(), pooledGood(), benchGood(100, 1001)).g5.pass).toBe(false);
});
test("形式ゲート: mass < 0.95 / 違反 2% 以上 / エラー", () => {
  const ev = allGood(); ev.boolq = te(); ev.boolq.mass_mean = 0.94;
  expect(judge(ev, pooledGood(), benchGood()).g1.pass).toBe(false);
  const ev2 = allGood(); ev2.ag_news.n_format_violation = 4; // 4/200 = 2%
  expect(judge(ev2, pooledGood(), benchGood()).g1.pass).toBe(false);
  const ev3 = allGood(); ev3.ag_news.n_err = 1;
  expect(judge(ev3, pooledGood(), benchGood()).g1.pass).toBe(false);
});
test("選択的精度: cov は task 別閾値、AUROC は一律 0.75", () => {
  const ev = allGood(); ev.banking77_15 = te({ max_cov_at_prec_95: 0.29 });
  expect(judge(ev, pooledGood(), benchGood()).g4.pass).toBe(false);
  const ev2 = allGood(); ev2.boolq = te({ max_cov_at_prec_95: 0.49 }); // boolq は 0.5 必要
  expect(judge(ev2, pooledGood(), benchGood()).g4.pass).toBe(false);
  const ev3 = allGood(); ev3.ag_news = te({ auroc: 0.74 });
  expect(judge(ev3, pooledGood(), benchGood()).g4.pass).toBe(false);
});
test("データ欠損 -> 未判定（タスク欠損・bench 欠損）", () => {
  const ev = allGood(); delete (ev as any).sst5;
  expect(judge(ev, pooledGood(), benchGood()).verdict).toBe("未判定");
  expect(judge(allGood(), pooledGood(), null).verdict).toBe("未判定");
});

test("tasks 引数: sst5 を除いた 5 タスクでの判定（補足用）", () => {
  const ev = allGood(); ev.sst5 = te({ accuracy: 0.1, auroc: 0.4, max_cov_at_prec_95: 0 }); // sst5 が壊れていても
  expect(judge(ev, pooledGood(), benchGood()).verdict).toBe("C");
  const five = TASKS.filter((t) => t !== "sst5");
  expect(judge(ev, pooledGood(), benchGood(), five).verdict).toBe("A"); // 5 タスクだけで判定すれば A
  const ev2 = allGood(); delete (ev2 as any).sst5;
  expect(judge(ev2, pooledGood(), benchGood(), five).verdict).toBe("A");
});
