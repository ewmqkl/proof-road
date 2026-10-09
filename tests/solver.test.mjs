// tests/solver.test.mjs —— 解算器：搜出的证明必须过内核，且不能假成功
import assert from 'node:assert/strict';
import { test } from './_runner.mjs';
import { compileLevel } from '../src/core/level-utils.js';
import { LEVELS } from '../src/data/levels.js';
import { findProof, verifyPlan } from '../src/core/solver.js';
import { createState, applyStep, matchedFact } from '../src/core/proof.js';
import { FOUND_PROOFS } from '../src/data/found-proofs.js';

/** 把计划在真实关卡状态上重放，独立确认达阵（steps / derivations 都是“裸步骤”） */
function replay(level, plan) {
  const st = createState(level);
  for (const d of plan.derivations || []) applyStep(st, d);
  for (const s of plan.steps) applyStep(st, s && s.step ? s.step : s);
  return !!matchedFact(st);
}

test('解算器对命题逻辑关卡能秒解', () => {
  const quick = ['L0-01', 'L0-02', 'L0-03', 'L0-04', 'L0-05', 'L0-06', 'L0-07', 'L0-08', 'L0-09', 'L0-10', 'L0-11', 'L0-13', 'L0-14'];
  const t0 = Date.now();
  for (const id of quick) {
    const lv = LEVELS.find((l) => l.id === id);
    const r = findProof(compileLevel(lv), { maxDepth: 6, budget: 8000, timeMs: 4000 });
    assert.ok(r.ok, id + ' 没搜到：' + r.reason);
    assert.ok(replay(lv, r), id + ' 搜到了但重放没达阵');
  }
  const ms = Date.now() - t0;
  assert.ok(ms < 20000, '这 13 关应当很快，实际用了 ' + ms + 'ms');
  console.log('   ' + quick.length + ' 关合计 ' + ms + 'ms');
});

test('解算器不会假成功（未证到目标的计划必须被拒）', () => {
  // 构造一个“目标无法从前提推出”的关卡：A → B 却要证 B
  const lv = {
    id: 'X-false', tier: 'L0', title: '不可能的目标', goal: 'B',
    premises: ['A -> B'], rules: ['hyp', 'impE'], atoms: ['A', 'B'],
  };
  const r = findProof(compileLevel(lv), { maxDepth: 4, budget: 3000, timeMs: 3000 });
  assert.equal(r.ok, false, '不可能的目标不该被证明出来');
});

test('已生成的证明数据文件：每条都要能重放达阵', () => {
  let checked = 0;
  for (const [id, plan] of Object.entries(FOUND_PROOFS)) {
    if (!plan) continue;                        // 解算器没解出来的关卡（记录为 null）
    const lv = LEVELS.find((l) => l.id === id);
    assert.ok(lv, '数据文件里有未知关卡 ' + id);
    assert.ok(plan.steps.length > 0, id + ' 的证明为空');
    assert.ok(replay(lv, plan), id + ' 的已存证明重放后没有达阵');
    assert.ok(verifyPlan(compileLevel(lv), plan.derivations, plan.steps.map((s) => ({ step: s }))), id + ' 未通过计划校验');
    checked++;
  }
  assert.ok(checked >= 15, '已存证明数量偏少：' + checked);
  console.log('   已存证明 ' + checked + ' 条全部重放通过');
});
