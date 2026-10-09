// tests/ui-play.test.mjs —— 用界面逻辑（含候选面板）逐关复演标准证明
import assert from 'node:assert/strict';
import { test } from './_runner.mjs';
import * as logic from '../src/core/logic.js';
import { P, fkey, termKey } from '../src/core/logic.js';
import { LEVELS } from '../src/data/levels.js';
import { createState, applyStep, tryStep, matchedFact, visibleFacts } from '../src/core/proof.js';
import { candidateSteps } from '../src/ui/candidates.js';

/** 把脚本步骤翻译成“已解析”的步骤：id -> 公式/项/操作数 */
function resolveStep(state, step) {
  const { parse, parseTerm } = logic;
  const out = { ...step };
  if (typeof out.term === 'string') out.term = parseTerm(out.term, state.compiled.sig, state.compiled.pOpts);
  if (typeof out.formula === 'string') out.formula = parse(out.formula, state.compiled.sig, state.compiled.pOpts);
  if (out.op && out.op.n === undefined) out.op = { name: out.op.name };
  return out;
}

/** 用界面会给出的候选来推进一步；返回是否成功 */
function uiStep(state, rawStep) {
  const wanted = resolveStep(state, rawStep);
  const cands = candidateSteps(state, wanted.rule, wanted.ids || []);
  const norm = (s) => JSON.stringify({
    r: s.rule, i: (s.ids || []).slice().sort(),
    t: s.term ? termKey(s.term) : null,
    p: s.pick || null, o: s.op || null,
    f: s.formula ? fkey(s.formula) : null,
  });
  const want = norm(wanted);
  const exact = cands.find((c) => norm(c.step) === want);
  if (exact) return exact;
  // 没有完全相同的候选，就找结果一致的那个
  const targetResult = tryStep(state, wanted);
  if (targetResult.ok) {
    const wantKey = fkey(targetResult.fact.f);
    const wantText = P(targetResult.fact.f);
    const byResult = cands.find((c) => {
      const r = tryStep(state, c.step);
      return r.ok && (fkey(r.fact.f) === wantKey || P(r.fact.f) === wantText);
    });
    if (byResult) return byResult;
  }
  // 界面上还有“自己写项 / 结果式”的入口：脚本里显式给出的项等价于玩家自己输入
  if (targetResult.ok && typeof rawStep.term === 'string') return { step: wanted, label: '自定义：' + rawStep.term };
  if (targetResult.ok && typeof rawStep.formula === 'string') return { step: wanted, label: '自定义：' + rawStep.formula };
  return null;
}

test('每一关都能只用界面候选走通标准证明', () => {
  const report = [];
  for (const lv of LEVELS) {
    if (!lv.script || lv.noScript) { report.push(lv.id + ': 开放练习（跳过）'); continue; }
    const state = createState(lv);
    let ok = true;
    for (const step of lv.script) {
      if (step.assume !== undefined) { applyStep(state, step); continue; }
      const chosen = uiStep(state, step);
      if (!chosen) {
        ok = false;
        report.push(lv.id + ' ✗ 界面给不出这一步：' + JSON.stringify(step));
        break;
      }
      // 按脚本给的 id 落子（界面里事实 id 由状态机分配，这里为了后续步骤能对上）
      applyStep(state, step.id ? { ...chosen.step, id: step.id } : chosen.step);
    }
    if (ok) {
      assert.ok(matchedFact(state), lv.id + ' 用界面候选走完却没有达阵');
      report.push(lv.id + ' ✓');
    }
  }
  const failed = report.filter((r) => r.indexOf('✗') >= 0);
  assert.equal(failed.length, 0, failed.join(' | '));
  const played = report.filter((r) => r.indexOf('✓') >= 0).length;
  assert.ok(played >= 25, '可复演关卡偏少：' + played);
  console.log('   界面可复演：' + played + ' 关');
});

test('多结果时界面会给出候选，而不会静默失败', () => {
  const lv = LEVELS.find((l) => l.id === 'L0-04');
  const state = createState(lv);
  const cands = candidateSteps(state, 'andE', [state.facts[0].id]);
  assert.equal(cands.length, 2, '∧E 应给出“取左/取右”两个候选');
  assert.ok(cands.every((c) => c.label && c.label.length > 0), '候选缺少可读标签');
});
