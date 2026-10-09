// tests/printer.test.mjs —— 打印与重解析的一致性（括号正确性）
import assert from 'node:assert/strict';
import { test } from './_runner.mjs';
import { makeSig, termStr, parseTerm, termEq, parse, P, alphaEq } from '../src/core/logic.js';

const sig = makeSig({ atoms: ['A', 'B', 'C'], consts: ['S'] });
const V = (s) => ({ k: 'v', name: s, free: true });
const N = (n) => ({ k: 'n', n });
const C = (name, ...args) => ({ k: 'c', name, args });

function gen(depth) {
  const leaves = [V('x'), V('y'), N(2), N(3)];
  if (depth === 0) return leaves;
  const out = leaves.slice();
  const sub = gen(depth - 1);
  for (const a of sub) for (const b of sub.slice(0, 8)) {
    for (const op of ['add', 'sub', 'mul', 'div']) out.push(C(op, a, b));
    out.push(C('sq', a));
    out.push(C('neg', a));
  }
  return out;
}

test('项的打印→重解析必须还原同一个结构', () => {
  const seen = new Set();
  let bad = 0, total = 0;
  for (const t of gen(2).slice(0, 1200)) {
    const key = JSON.stringify(t);
    if (seen.has(key)) continue;
    seen.add(key);
    total++;
    const s = termStr(t, [], 0);
    assert.doesNotThrow(() => parseTerm(s, sig), '无法重解析: ' + s);
    if (!termEq(t, parseTerm(s, sig))) { bad++; if (bad < 4) console.log('   不一致:', s); }
  }
  assert.equal(bad, 0, total + ' 个项里有 ' + bad + ' 个打印后结构改变');
  assert.ok(total > 300, '样本太少: ' + total);
});

test('公式的打印→重解析（α 等价）', () => {
  const cases = [
    'A -> B', '(A /\\ B) -> A', 'A ∧ B ∨ A', 'A ∨ B ∧ A', '¬(A ∧ B)',
    'forall x. x + 0 = x', 'exists x. x * x = 4', '∀x, ∀y, x < y → (∃z, x < z ∧ z < y)',
    '2 + 3 = 5', '|-3| = 3', '(x + 1)^2 = x^2 + 2*x + 1', 'x + (y + z) = (x + y) + z',
    'A ↔ (B → C)', 'not A or B', 'a ∈ S ∧ b ∈ S', 'A ∧ (B ∨ A)', '(A ∧ B) ∨ A',
    'A → (B → C)', '(A → B) → C', 'A ↔ (B ↔ C)',
  ];
  for (const src of cases) {
    const f = parse(src, sig);
    const back = parse(P(f), sig);
    assert.ok(alphaEq(f, back), '往返失败: ' + src + ' → ' + P(f) + ' → ' + P(back));
  }
});

test('除法与乘法的括号不会被丢掉', () => {
  assert.equal(termStr(C('mul', V('x'), C('add', V('x'), V('x'))), [], 0), 'x * (x + x)');
  assert.equal(termStr(C('div', V('x'), C('div', V('x'), V('x'))), [], 0), 'x / (x / x)');
  assert.equal(termStr(C('sub', V('x'), C('sub', V('x'), V('x'))), [], 0), 'x - (x - x)');
  assert.equal(termStr(C('sq', C('add', V('x'), N(1))), [], 0), '(x + 1)²');
});
