// tests/kernel.test.mjs —— 内核：解析、打印、de Bruijn 替换、α 等价
import assert from 'node:assert/strict';
import { test } from './_runner.mjs';
import { parse, parseTerm, P, termStr, alphaEq, instAll, openAt, freeVars, makeSig, v, c0 } from '../src/core/logic.js';

const sig = makeSig({ atoms: ['A', 'B', 'C'], consts: ['s', 't'] });
const cases = [
  'A -> B', '(A /\\ B) -> A', 'A -> (B -> A)', '¬A \\/ B', 'A ↔ (A ∨ A)',
  'forall x. x + 0 = x', 'forall x y. x + y = y + x', 'exists x. x * x = 4',
  '∀x, (x = 0) → (x + 1 = 1)', 'x + 1 > 0', '|x| ≥ 0',
  'x^2 + 2*x + 1 = (x + 1)^2', 'A ∈ S → A ∈ S', 'not A or B',
  '∀x, ∀y, x < y → (∃z, x < z ∧ z < y)', '(x + y) + z = x + (y + z)',
  '-a = 0 - a', '|-3| = 3',
];
test('解析-打印往返（α 等价）', () => {
  for (const src of cases) {
    const f = parse(src, sig);
    const again = parse(P(f), sig);
    assert.ok(alphaEq(f, again), '往返失败: ' + src + ' → ' + P(f) + ' → ' + P(again));
  }
});
test('未登记的裸变量当公式应报错', () => {
  assert.throws(() => parse('z -> z', sig), /命题原子/);
});
test('全称实例化替换正确', () => {
  const f = parse('forall x. x + 0 = x', sig);
  assert.equal(P(instAll(f, parseTerm('y + 1', sig))), 'y + 1 + 0 = y + 1');
  const g = parse('forall x. exists y. x < y + x', sig);
  assert.equal(P(instAll(g, parseTerm('2', sig))), '∃y, 2 < y + 2');
});
test('替换不会误伤内层同名绑定（de Bruijn 无捕获）', () => {
  const f = parse('forall x. forall y. x + y = y + x', sig);
  // 把外层 x 替换成项 w
  const r = instAll(f, v('w', true));
  assert.equal(P(r), '∀y, w + y = y + w');
  // 把外层 x 换成含 y 的项，也不会被内层 y 捕获
  const r2 = instAll(f, v('y', true));
  assert.equal(P(r2), '∀y, y + y = y + y');
});
test('打开量词会正确提升索引', () => {
  const f = parse('forall x. forall y. x = y', sig);
  const r = openAt(f.body, 0, v('a', true));
  assert.equal(P(r), '∀y, a = y');
});
test('子证明里的事实不能在子证明外引用（作用域真的合上了）', async () => {
  const { LEVELS } = await import('../src/data/levels.js');
  const { createState, applyStep, syncScopes, matchedFact } = await import('../src/core/proof.js');
  const lv = LEVELS.find((l) => l.id === 'L0-02');   // 目标 A -> A
  const st = createState(lv);
  // 假设 A，子证明里用 hyp 得到 A，然后合上（impI）
  applyStep(st, { rule: 'assume', assume: 'A', id: 'H1' });
  const inScope = applyStep(st, { rule: 'hyp', ids: ['H1'] });
  applyStep(st, { rule: 'impI', ids: [inScope.id], scope: 'H1' });
  // 现在 H1 这个假设已经合上：子证明里的那条事实不该还能用
  const st2 = createState(lv);
  try {
    const bad = applyStep(st2, { rule: 'hyp', ids: ['H1'] });
    assert.fail('不存在的前提 H1 竟然被接受了：' + JSON.stringify(bad));
  } catch (e) {
    assert.ok(/找不到前提/.test(e.message), '应当报“找不到前提”，实际：' + e.message);
  }
});

test('合上子证明后，子证明内的事实不再出现在可见事实里', async () => {
  const { LEVELS } = await import('../src/data/levels.js');
  const { createState, applyStep, visibleFacts } = await import('../src/core/proof.js');
  const lv = LEVELS.find((l) => l.id === 'L0-02');
  const st = createState(lv);
  applyStep(st, { rule: 'assume', assume: 'A', id: 'H1' });
  const inner = applyStep(st, { rule: 'hyp', ids: ['H1'] });
  applyStep(st, { rule: 'impI', ids: [inner.id], scope: 'H1' });
  const vis = visibleFacts(st).map((f) => f.id);
  assert.ok(vis.indexOf(inner.id) < 0, '合上后子证明内的事实 ' + inner.id + ' 仍可见');
});
test('子证明内推出的事实，合上后不能再被引用', async () => {
  const { LEVELS } = await import('../src/data/levels.js');
  const { createState, applyStep, visibleFacts } = await import('../src/core/proof.js');
  const lv = LEVELS.find((l) => l.id === 'L0-08');   // A->B, ¬B ⊢ ¬A（子证明里能推出 ⊥）
  const st = createState(lv);
  applyStep(st, { rule: 'assume', assume: 'A', id: 'H1' });
  const bFact = applyStep(st, { rule: 'impE', ids: ['p1', 'H1'] });      // B
  const botFact = applyStep(st, { rule: 'negE', ids: ['p2', bFact.id] }); // ⊥（作用域 H1）
  console.log('   子证明内事实: ' + botFact.id + ' scope=' + botFact.scope);
  applyStep(st, { rule: 'negI', ids: [botFact.id], scope: 'H1' });
  const vis = visibleFacts(st).map((f) => f.id);
  assert.ok(vis.indexOf(botFact.id) < 0, '合上后 ⊥（' + botFact.id + '）仍可见，作用域没生效');
});
test('嵌套子证明里的事实仍然是可见的（作用域可能是 H1|H2）', async () => {
  const { LEVELS } = await import('../src/data/levels.js');
  const { createState, applyStep, visibleFacts } = await import('../src/core/proof.js');
  const lv = LEVELS.find((l) => l.id === 'L0-10');
  const st = createState(lv);
  applyStep(st, { rule: 'assume', assume: 'A', id: 'H1' });            // 外层子证明
  applyStep(st, { rule: 'assume', assume: 'not B', id: 'H2' });        // 内层子证明
  const inner = applyStep(st, { rule: 'hyp', ids: ['H2'] });           // 内层里用前提
  console.log('   内层事实作用域: ' + inner.scope);
  const vis = visibleFacts(st).map((f) => f.id);
  assert.ok(vis.indexOf(inner.id) >= 0, '内层子证明里的事实（' + inner.id + '，作用域 ' + inner.scope + '）被判成不可见');
});
test('嵌套子证明：依赖两层假设的事实可见；合上内层后消失', async () => {
  const { LEVELS } = await import('../src/data/levels.js');
  const { createState, applyStep, visibleFacts } = await import('../src/core/proof.js');
  const lv = LEVELS.find((l) => l.id === 'L0-10');
  const st = createState(lv);
  applyStep(st, { rule: 'assume', assume: 'A', id: 'H1' });
  applyStep(st, { rule: 'assume', assume: 'not B', id: 'H2' });
  const b = applyStep(st, { rule: 'impE', ids: ['p1', 'H1'] });
  const bot = applyStep(st, { rule: 'negE', ids: ['H2', b.id] });
  assert.equal(bot.scope, 'H1|H2', '这个事实应当同时依赖两层假设');
  let vis = visibleFacts(st).map((f) => f.id);
  assert.ok(vis.indexOf(bot.id) >= 0, '依赖两层假设的事实被判成不可见');
  // 合上外层（¬I），两层假设都没了，这个事实应当消失
  applyStep(st, { rule: 'raa', ids: [bot.id], scope: 'H1' });
  vis = visibleFacts(st).map((f) => f.id);
  assert.ok(vis.indexOf(bot.id) < 0, '子证明合上后依赖它的事实仍然可见');
});
