// tests/levels.test.mjs —— 每一关的标准证明都必须真的走通
import assert from 'node:assert/strict';
import { test } from './_runner.mjs';
import { P, fstr, alphaEq } from '../src/core/logic.js';
import { LEVELS } from '../src/data/levels.js';
import { createState, runScript, goalReached, isTrivial } from '../src/core/proof.js';

const withScript = LEVELS.filter((l) => !l.noScript && l.script);
test('所有关卡都能编译出目标与公理', () => {
  for (const level of LEVELS) {
    const st = createState(level);
    assert.ok(st.goal, level.id + ' 缺少目标');
    assert.equal(st.facts.filter((f) => f.rule === 'premise').length, (level.premises || []).length, level.id + ' 题设数量不符');
    assert.equal(st.facts.filter((f) => f.rule === 'axiom').length, st.compiled.axioms.length);
  }
});
test('带标准证明的关卡：逐步执行且达阵', () => {
  let checked = 0;
  for (const level of withScript) {
    const res = runScript(level, level.script);
    assert.ok(res.ok, level.id + ' 第 ' + (res.steps.length + 1) + ' 步失败：' + res.error);
    assert.ok(res.solved, level.id + ' 走完脚本但没达到目标 ' + P(level.goal ? createState(level).goal : null));
    checked++;
  }
  assert.ok(checked >= 20, '检查的关卡数偏少：' + checked);
});
test('没有标准证明的关卡也必须有明确目标', () => {
  for (const level of LEVELS.filter((l) => l.noScript)) {
    assert.ok(level.scriptNote || level.teach, level.id + ' 应有解题提示');
  }
});
test('结论不能凭空得到：整体确认', () => {
  for (const level of withScript) {
    const st = createState(level);
    if (isTrivial(level)) continue;   // 目标本身就是题设/公理（如 L1-04）
    assert.equal(goalReached(st), false, level.id + ' 未做任何推理就判定完成');
  }
});
test('每一关的手写标准证明都必须真的跑得通并达阵', async () => {
  const { LEVELS } = await import('../src/data/levels.js');
  const { runScript } = await import('../src/core/proof.js');
  let checked = 0, open = 0;
  for (const lv of LEVELS) {
    if (!lv.script || lv.noScript) { open++; continue; }
    const r = runScript(lv, lv.script);
    assert.ok(r.ok, lv.id + ' 的标准证明跑不通：' + r.error);
    assert.ok(r.solved, lv.id + ' 的标准证明跑完没有达阵');
    checked++;
  }
  console.log('   标准证明 ' + checked + ' 关全部达阵，开放练习 ' + open + ' 关');
  assert.ok(checked >= 28, '有标准证明的关卡偏少：' + checked);
});
