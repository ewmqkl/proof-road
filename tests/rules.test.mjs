// tests/rules.test.mjs —— 自然演绎规则：正例与反例
import assert from 'node:assert/strict';
import { test } from './_runner.mjs';
import { parse, parseTerm, makeSig, P } from '../src/core/logic.js';
import { runRule, makeFact, RuleError } from '../src/core/rules.js';

const sig = makeSig({ atoms: ['A', 'B', 'C', 'D'] });
const newState = () => ({ facts: [], nextId: 1, assumeCount: 0, assumptions: {}, scopeStack: [] });
const F = (s) => parse(s, sig);
function add(state, s, id) {
  const f = { id: id || 'g' + state.nextId++, f: F(s), rule: 'hyp', from: [], scope: null };
  state.facts.push(f);
  return f.id;
}
function run(state, req) { return runRule(state, req); }
function step(state, req) { const r = run(state, req); return makeFact(state, r, req.ids || []); }

test('→E 假言推理', () => {
  const s = newState();
  const a = add(s, 'A -> B'), b = add(s, 'A');
  assert.equal(P(step(s, { rule: 'impE', ids: [a, b] }).f), 'B');
});
test('→E 前提不匹配必须报错', () => {
  const s = newState();
  const a = add(s, 'A -> B'), c = add(s, 'C');
  assert.throws(() => run(s, { rule: 'impE', ids: [a, c] }), RuleError);
});
test('∧I / ∧E', () => {
  const s = newState();
  const a = add(s, 'A'), b = add(s, 'B');
  const ab = step(s, { rule: 'andI', ids: [a, b] });
  assert.equal(P(ab.f), 'A ∧ B');
  assert.equal(P(run(s, { rule: 'andE', ids: [ab.id], pick: '左' }).f), 'A');
  assert.equal(P(run(s, { rule: 'andE', ids: [ab.id], pick: '右' }).f), 'B');
  assert.throws(() => run(s, { rule: 'andE', ids: [ab.id] }), /选择/);
});
test('∨E 分情况讨论', () => {
  const s = newState();
  const d = add(s, 'A \\/ B'), i1 = add(s, 'A -> C'), i2 = add(s, 'B -> C');
  assert.equal(P(step(s, { rule: 'orE', ids: [d, i1, i2] }).f), 'C');
});
test('∨E 两支结论不同必须报错', () => {
  const s = newState();
  const d = add(s, 'A \\/ B'), i1 = add(s, 'A -> C'), i2 = add(s, 'B -> D');
  assert.throws(() => run(s, { rule: 'orE', ids: [d, i1, i2] }), /结论必须相同/);
});
test('→I 需要子证明作用域', () => {
  const s = newState();
  const h = { id: 'H1', f: F('A'), rule: 'assume', from: [], scope: 'H1' };
  s.facts.push(h); s.assumptions.H1 = F('A'); s.scopeStack.push('H1');
  assert.equal(P(step(s, { rule: 'impI', ids: ['H1'] }).f), 'A → A');
  // 没有作用域时应当报错
  const s2 = newState();
  const g = add(s2, 'A');
  assert.throws(() => run(s2, { rule: 'impI', ids: [g] }), /子证明/);
});
test('¬E / ¬I / 反证法', () => {
  const s = newState();
  const a = add(s, 'A'), na = add(s, 'not A');
  const bot = step(s, { rule: 'negE', ids: [a, na] });
  assert.equal(P(bot.f), '⊥');
  // ¬I：假设 A 推出 ⊥ => ¬A
  const s2 = newState();
  s2.facts.push({ id: 'H1', f: F('A'), rule: 'assume', from: [], scope: 'H1' });
  s2.assumptions.H1 = F('A'); s2.scopeStack.push('H1');
  const f1 = { id: 'f1', f: F('false'), rule: 'negE', from: [], scope: 'H1' };
  s2.facts.push(f1);
  assert.equal(P(step(s2, { rule: 'negI', ids: ['f1'] }).f), '¬A');
  // 反证法：假设 ¬A 推出 ⊥ => A
  const s3 = newState();
  s3.facts.push({ id: 'H1', f: F('not A'), rule: 'assume', from: [], scope: 'H1' });
  s3.assumptions.H1 = F('not A'); s3.scopeStack.push('H1');
  const g1 = { id: 'f1', f: F('false'), rule: 'negE', from: [], scope: 'H1' };
  s3.facts.push(g1);
  assert.equal(P(step(s3, { rule: 'raa', ids: ['f1'] }).f), 'A');
});
test('∀E 实例化 / ∃I 见证', () => {
  const s = newState();
  const u = add(s, 'forall x. x + 0 = x');
  assert.equal(P(run(s, { rule: 'allE', ids: [u], term: parseTerm('y + 1', sig) }).f), 'y + 1 + 0 = y + 1');
  const p = add(s, 'y + 0 = y');
  assert.equal(P(run(s, { rule: 'exI', ids: [p], term: parseTerm('y', sig) }).f), '∃y, y + 0 = y');
});
test('等词：=I / =Sym / =Trans / =Sub', () => {
  const s = newState();
  assert.equal(P(run(s, { rule: 'eqRefl', term: parseTerm('a + b', sig) }).f), 'a + b = a + b');
  const e1 = add(s, 'a = b'), e2 = add(s, 'b = c');
  assert.equal(P(step(s, { rule: 'eqSym', ids: [e1] }).f), 'b = a');
  assert.equal(P(step(s, { rule: 'eqTrans', ids: [e1, e2] }).f), 'a = c');
  const t = add(s, 'a + c = d');
  assert.equal(P(step(s, { rule: 'eqRewrite', ids: [e1, t] }).f), 'b + c = d');
});
test('=Sub 不会替换量词内部的绑定变量', () => {
  const s = newState();
  const e = add(s, 'y = x');
  const t = add(s, 'forall x. x + 0 = x');
  // ∀ 内部的 x 是绑定变量，替换 y→x 在这里无从下手
  assert.throws(() => run(s, { rule: 'eqRewrite', ids: [e, t] }), /找不到可替换/);
  // 而在自由出现的公式里可以正常替换
  const t2 = add(s, 'y + 0 = y');
  assert.equal(P(step(s, { rule: 'eqRewrite', ids: [e, t2] }).f), 'x + 0 = x');
});
test('↔I / ↔E', () => {
  const s = newState();
  const i1 = add(s, 'A -> B'), i2 = add(s, 'B -> A');
  const iff = step(s, { rule: 'iffI', ids: [i1, i2] });
  assert.equal(P(iff.f), 'A ↔ B');
  assert.equal(P(run(s, { rule: 'iffE', ids: [iff.id], pick: '→' }).f), 'A → B');
  assert.equal(P(run(s, { rule: 'iffE', ids: [iff.id], pick: '←' }).f), 'B → A');
});
test('Ring 化简：正确等式通过，错误等式拒绝', () => {
  const s = newState();
  assert.equal(P(run(s, { rule: 'ring', ids: [add(s, '(x + 1)^2 = x^2 + 2*x + 1')] }).f), 'x² + 2 * x + 1 = x² + 2 * x + 1');
  assert.equal(P(run(s, { rule: 'ring', ids: [add(s, '(x + y)*(x - y) = x^2 - y^2')] }).f), 'x² - y² = x² - y²');
  assert.equal(P(run(s, { rule: 'ring', ids: [add(s, '2*x + 3*x = 5*x')] }).f), '5 * x = 5 * x');
  assert.throws(() => run(s, { rule: 'ring', ids: [add(s, 'x + 1 = 3')] }), /不是同一个多项式/);
  assert.throws(() => run(s, { rule: 'ring', ids: [add(s, 'x / 2 = x')] }), /暂不支持/);
});
test('数值计算只对具体数字生效', () => {
  const s = newState();
  assert.equal(P(run(s, { rule: 'arith', ids: [add(s, '2 + 3 = 5')] }).f), '5 = 5');
  assert.equal(P(run(s, { rule: 'arith', ids: [add(s, '|-3| = -(-3)')] }).f), '3 = 3');
  assert.throws(() => run(s, { rule: 'arith', ids: [add(s, 'x + 3 = 5')] }), /具体数字/);
});
