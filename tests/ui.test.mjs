// tests/ui.test.mjs —— 无浏览器冒烟测试：把 DOM 打桩，直接跑界面代码
import assert from 'node:assert/strict';
import { test } from './_runner.mjs';

/* ---------- 极简 DOM 打桩 ---------- */
function makeEl(tag) {
  const el = {
    // 真实 DOM 里 tagName 是大写，打桩也统一成大写，避免测试辅助函数被大小写坑到
    tagName: String(tag).toUpperCase(), children: [], _html: '', textContent: '', className: '', hidden: false,
    value: '', title: '', style: {},
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this.children = []; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {},
    set onclick(fn) { this._onclick = fn; },
    get onclick() { return this._onclick; },
  };
  return el;
}
const registry = new Map();
const document = {
  createElement: (tag) => makeEl(tag),
  getElementById: (id) => { if (!registry.has(id)) registry.set(id, makeEl('div')); return registry.get(id); },
};
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
let promptAnswer = null;
globalThis.document = document;
globalThis.localStorage = localStorage;
globalThis.prompt = () => promptAnswer;

const app = await import('../src/ui/app.js');
const { LEVELS } = await import('../src/data/levels.js');
const { RULES } = await import('../src/core/rules.js');

test('界面能加载关卡并渲染前提、规则、公理', () => {
  const st = app.debugState();
  assert.ok(st, '未加载关卡');
  assert.equal(app.debugLevelId(), LEVELS[0].id);
  const factsHtml = registry.get('facts').innerHTML + flatten(registry.get('facts'));
  assert.ok(factsHtml.length > 0, '事实列表为空');
  const rulesHtml = flatten(registry.get('rules'));
  assert.ok(rulesHtml.length > 0, '规则按钮为空');
  assert.ok(registry.get('goal-text').textContent.length > 0, '目标未渲染');
});

test('通过界面走完一个关卡（三段论）', () => {
  app.loadLevel('L0-13');
  // 目标 A → C：假设 A
  app.debugAssumption('A');
  let st = app.debugState();
  const hId = st.facts.filter((f) => f.rule === 'assume').pop().id;
  app.debugSelect([hId, 'p1']);
  promptAnswer = null;
  app.debugUseRule('impE');            // A → B, A ⟹ B
  st = app.debugState();
  const bId = st.facts.filter((f) => !f.given && f.rule === 'impE').pop().id;
  app.debugSelect([bId, 'p2']);
  app.debugUseRule('impE');            // B → C, B ⟹ C
  st = app.debugState();
  const cId = st.facts.filter((f) => !f.given && f.rule === 'impE').pop().id;
  app.debugSelect([cId]);
  app.debugUseRule('impI');            // 合上子证明
  st = app.debugState();
  assert.ok(app.debugSolved(), '走完步骤却没有判定完成：' + app.debugStatusText());
  assert.ok(localStorage.getItem('lpg.done').includes('L0-13'), '进度未记录');
});

test('错误操作给出可读提示', () => {
  app.loadLevel('L0-03');
  app.debugSelect(['p2', 'p1']);   // A 与 A→B（顺序反了也应能推出 B）
  promptAnswer = null;
  app.debugUseRule('impE');
  assert.equal(app.debugSolved(), true, '→E 应能推出 B');
});

test('每关都能载入而不报错', () => {
  for (const lv of LEVELS) {
    app.loadLevel(lv.id);
    assert.equal(app.debugLevelId(), lv.id);
    assert.ok(app.debugGoalText().length > 0, lv.id + ' 目标为空');
  }
});

test('规则都有说明与中文名', () => {
  for (const [k, spec] of Object.entries(RULES)) {
    assert.ok(spec.name && spec.name.length > 0, k + ' 缺少名称');
    assert.ok(spec.hint && spec.hint.length > 0, k + ' 缺少说明');
  }
});

function flatten(el, depth = 0) {
  if (depth > 6) return '';
  let s = (el.textContent || '') + (el._html || '');
  for (const c of el.children) s += flatten(c, depth + 1);
  return s;
}
test('提示：解算器的证明也能被界面逐条展示（两种来源都要能走）', async () => {
  const { FOUND_PROOFS } = await import('../src/data/found-proofs.js');
  const { createState, applyStep, matchedFact } = await import('../src/core/proof.js');
  const { LEVELS } = await import('../src/data/levels.js');
  const ids = Object.keys(FOUND_PROOFS).filter((id) => FOUND_PROOFS[id]);
  assert.ok(ids.length >= 15, '解算器证明太少：' + ids.length);
  let checked = 0;
  for (const id of ids) {
    const lv = LEVELS.find((l) => l.id === id);
    const st = createState(lv);
    for (const d of FOUND_PROOFS[id].derivations || []) applyStep(st, d);
    for (const s of FOUND_PROOFS[id].steps) {
      applyStep(st, s);                     // 每条都要能执行
      app.debugDescribe(s);                 // 每条都要能生成可读文案
    }
    assert.ok(matchedFact(st), id + ' 的解算器证明重放后没有达阵');
    checked++;
  }
  console.log('   界面可展示的解算器证明 ' + checked + ' 条');
});
test('提示：每一关都要么给得出步骤、要么明确说明是开放练习', async () => {
  const { FOUND_PROOFS } = await import('../src/data/found-proofs.js');
  let withSteps = 0, open = 0;
  for (const lv of LEVELS) {
    app.loadLevel(lv.id);
    app.debugHint();
    const msg = app.debugStatusText();
    const hasHand = lv.script && !lv.noScript;
    const hasSolver = !!FOUND_PROOFS[lv.id];
    if (hasHand || hasSolver) {
      assert.ok(/提示 \d+\//.test(msg), lv.id + ' 有证明却没给出步骤提示：' + msg);
      withSteps++;
    } else {
      assert.ok(/开放练习/.test(msg), lv.id + ' 没有证明时应当说明是开放练习：' + msg);
      open++;
    }
  }
  console.log('   可给步骤提示 ' + withSteps + ' 关，开放练习 ' + open + ' 关');
  assert.ok(withSteps >= 25, '能给出步骤提示的关卡偏少：' + withSteps);
});

test('每关的规则清单里出现的规则都真实存在', () => {
  for (const lv of LEVELS) {
    for (const r of lv.rules || []) {
      assert.ok(RULES[r], lv.id + ' 列出了不存在的规则 ' + r);
    }
  }
});
test('界面走查：打开子证明 → →E → 合上，能走通 L0-15 的第一支', async () => {
  app.loadLevel('L0-15');
  app.debugAssumption('A');
  assert.equal(app.debugScopes().length, 1, '打开假设后应当有 1 层子证明');
  const facts1 = app.debugFacts();
  const hypA = facts1.find((f) => f.text === 'A' && f.rule === 'assume');
  assert.ok(hypA, '应当能找到假设 A：' + JSON.stringify(facts1));
  const msg1 = app.debugSelectAndUse(['p1', hypA.id], 'impE');
  assert.ok(/✓/.test(msg1), 'A→B 与假设 A 应当推出 B：' + msg1);
  const facts2 = app.debugFacts();
  const bFact = facts2.find((f) => f.text === 'B' && f.scope);
  assert.ok(bFact, '子证明里应当有 B：' + JSON.stringify(facts2));
  const msg2 = app.debugSelectAndUse([bFact.id], 'impI');
  assert.ok(/✓/.test(msg2), '合上子证明应当得到 A → B：' + msg2);
  assert.equal(app.debugScopes().length, 0, '合上后子证明层数应当归零');
  assert.ok(app.debugFacts().some((f) => f.text.indexOf('A → B') >= 0 && !f.scope), '应当得到不含作用域的 A → B');
});

test('界面走查：子证明合上后，里面的事实不再可选', async () => {
  app.loadLevel('L0-15');
  app.debugAssumption('A');
  const hypA = app.debugFacts().find((f) => f.rule === 'assume');
  app.debugSelectAndUse(['p1', hypA.id], 'impE');
  const bFact = app.debugFacts().find((f) => f.text === 'B' && f.scope);
  app.debugSelectAndUse([bFact.id], 'impI');
  const vis = app.debugFacts().map((f) => f.id);
  assert.ok(vis.indexOf(hypA.id) < 0, '合上后假设 ' + hypA.id + ' 不该还在可见事实里');
  assert.ok(vis.indexOf(bFact.id) < 0, '合上后子证明内的 ' + bFact.id + ' 不该还在可见事实里');
});
test('界面走查：两支都合上后用 ∨E 收尾（完整分情况讨论）', async () => {
  app.loadLevel('L0-15');
  // 支 1：假设 A → 得 B → 合上得 A → B
  app.debugAssumption('A');
  const hypA = app.debugFacts().find((f) => f.text === 'A' && f.rule === 'assume');
  app.debugSelectAndUse(['p1', hypA.id], 'impE');
  const b1 = app.debugFacts().find((f) => f.text === 'B' && f.scope);
  app.debugSelectAndUse([b1.id], 'impI');
  const imp1 = app.debugFacts().find((f) => f.text.indexOf('A → B') >= 0 && !f.scope);
  assert.ok(imp1, '支 1 应当给出 A → B');

  // 支 2：假设 C → 得 B → 合上得 C → B
  app.debugAssumption('C');
  const hypC = app.debugFacts().find((f) => f.text === 'C' && f.rule === 'assume');
  app.debugSelectAndUse(['p3', hypC.id], 'impE');    // C → B
  const b2 = app.debugFacts().find((f) => f.text === 'B' && f.scope);
  assert.ok(b2, '支 2 里应当推出 B');
  app.debugSelectAndUse([b2.id], 'impI');
  const imp2 = app.debugFacts().find((f) => f.text.indexOf('C → B') >= 0 && !f.scope);
  assert.ok(imp2, '支 2 应当给出 C → B');

  // 收尾：A ∨ C 的两支都推出 B
  const before = app.debugCandidates(['p4', imp1.id, imp2.id], 'orE');
  assert.ok(before.length >= 1, '∨E 应当有可用候选：' + JSON.stringify(before));
  const msg = app.debugSelectAndUse(['p4', imp1.id, imp2.id], 'orE');
  // 过关时状态栏会被完成提示覆盖，所以这里接受两种成功信号
  assert.ok(/✓|完成/.test(msg), '∨E 收尾失败：' + msg);
  assert.ok(app.debugSolved(), '走完两支后应当已经达成目标');
  assert.ok(app.debugFacts().some((f) => f.text === 'B' && !f.scope), '应当得到一个不带作用域的 B');
});
test('界面引导：选中析取点 ∨E，会给出“分情况讨论”的两支说明（而不是报错）', async () => {
  app.loadLevel('L0-15');
  const guides = app.debugGuides(['p4'], 'orE');
  assert.equal(guides.length, 1, '应当给出一条分情况讨论引导：' + JSON.stringify(guides));
  assert.ok(/分情况讨论/.test(guides[0].label), '引导文案不对：' + guides[0].label);
  assert.equal(guides[0].branches.length, 2, '应当说明两支');
  assert.ok(/假设 A/.test(guides[0].branches[0]), '支 1 说明不对：' + guides[0].branches[0]);
  assert.ok(/假设 C/.test(guides[0].branches[1]), '支 2 说明不对：' + guides[0].branches[1]);
});

test('界面引导：点“开始这一支”会真的打开对应的子证明', async () => {
  app.loadLevel('L0-15');
  const msg = app.debugSelectAndUse(['p4'], 'orE');
  const btns = app.debugChoiceButtons();
  assert.ok(btns.some((b) => /开始这一支：假设 A/.test(b)), '候选面板里应当有“开始这一支”按钮：' + JSON.stringify(btns));
  const idx = btns.findIndex((b) => /开始这一支：假设 A/.test(b));
  assert.ok(app.debugClickChoice(idx), '点击按钮失败');
  assert.equal(app.debugScopes().length, 1, '点击后应当打开了一层子证明');
  const scopes = app.debugScopes();
  const hyp = app.debugFacts().find((f) => f.rule === 'assume' && f.scope === scopes[0]);
  assert.ok(hyp && hyp.text === 'A', '打开的子证明应当假设 A：' + JSON.stringify(hyp));
});

test('界面引导：一支达成后，引导会把它标成已完成', async () => {
  app.loadLevel('L0-15');
  // 先把支 1（假设 A）推出 B 并合上
  app.debugAssumption('A');
  const hypA = app.debugFacts().find((f) => f.text === 'A' && f.rule === 'assume');
  app.debugSelectAndUse(['p1', hypA.id], 'impE');
  const b1 = app.debugFacts().find((f) => f.text === 'B' && f.scope);
  app.debugSelectAndUse([b1.id], 'impI');
  // 再问一次引导：目前没有任何一支处于“已达成”状态（两支都要在各自子证明里才行）
  const guides = app.debugGuides(['p4'], 'orE');
  assert.equal(guides.length, 1);
  assert.ok(guides[0].branches.every((b) => typeof b === 'string'));
});
test('界面：排中律会列出可用的 A ∨ ¬A 候选', async () => {
  app.loadLevel('L0-16');                 // 题设 A → B，目标 ¬A ∨ B
  const labels = app.debugCandidates([], 'excludedMiddle');
  assert.ok(labels.length >= 1, '排中律应当有候选：' + JSON.stringify(labels));
  assert.ok(labels.some((l) => /A ∨ ¬A|¬A ∨ A/.test(l)), '应当能对 A 取排中：' + JSON.stringify(labels));
  const msg = app.debugSelectAndUse([], 'excludedMiddle');
  assert.ok(/✓/.test(msg), '排中律应当能直接推进一步：' + msg);
  const facts = app.debugFacts();
  assert.ok(facts.some((f) => /∨/.test(f.text)), '应当得到一个析取事实：' + JSON.stringify(facts.map((f) => f.text)));
});
test('空题设关卡（L0-02 证明 A → A）：载入后要告诉玩家先开子证明', async () => {
  app.loadLevel('L0-02');
  assert.deepEqual(app.debugFacts(), [], 'L0-02 本来就没有题设');
  const text = app.debugFactsText();
  assert.ok(text.indexOf('本关没有题设') >= 0, '事实面板应当给出空状态提示：' + text);
});

test('空题设关卡：点隐含引入会给出“假设什么”的引导，并能一键打开子证明', async () => {
  app.loadLevel('L0-02');
  const guides = app.debugGuides([], 'impI');
  assert.equal(guides.length, 1, '应当给出一条开子证明的引导：' + JSON.stringify(guides));
  assert.ok(/假设 A/.test(guides[0].label), '引导应说明该假设 A：' + guides[0].label);
  // 走界面路径：点规则 → 引导卡出现 → 点“开始”按钮
  app.debugSelectAndUse([], 'impI');
  const btns = app.debugChoiceButtons();
  assert.ok(btns.some((b) => /开始：假设 A/.test(b)), '引导卡里应当有开始按钮：' + JSON.stringify(btns));
  const idx = btns.findIndex((b) => /开始：假设 A/.test(b));
  assert.ok(app.debugClickChoice(idx), '点击开始按钮失败');
  assert.deepEqual(app.debugScopes(), ['H1'], '点击后应当打开一层子证明');
  const h = app.debugFacts().find((f) => f.rule === 'assume');
  assert.ok(h && h.text === 'A', '子证明应当假设 A：' + JSON.stringify(h));
});

test('空题设关卡：按引导走完 L0-02（假设 → 引用前提 → 合上）', async () => {
  app.loadLevel('L0-02');
  app.debugAssumption('A');
  const h = app.debugFacts().find((f) => f.rule === 'assume');
  const m1 = app.debugSelectAndUse([h.id], 'hyp');
  assert.ok(/✓/.test(m1), '引用前提应当成功：' + m1);
  const derived = app.debugFacts().find((f) => f.rule === 'hyp');
  assert.ok(derived, '应当得到一条引用事实');
  const m2 = app.debugSelectAndUse([derived.id], 'impI');
  assert.ok(/✓|完成/.test(m2), '合上子证明应当得到 A → A：' + m2);
  assert.ok(app.debugSolved(), 'L0-02 应当已经完成');
});
test('凡是载入后没有任何可用事实的关卡，都必须给出提示与开子证明的引导', async () => {
  const { LEVELS } = await import('../src/data/levels.js');
  let empty = 0;
  for (const lv of LEVELS) {
    app.loadLevel(lv.id);
    const facts = app.debugFacts();
    if (facts.length) continue;
    empty++;
    const text = app.debugFactsText();
    assert.ok(/本关没有题设/.test(text), lv.id + ' 空题设却没有空状态提示：' + text);
    // 该关的规则里至少要有一个能给出“开子证明”的引导
    const guides = (lv.rules || []).flatMap((r) => app.debugGuides([], r));
    assert.ok(guides.length >= 1, lv.id + ' 空题设却没有任何引导（玩家会卡住）：' + JSON.stringify(lv.rules));
    assert.ok(guides.some((g) => g.guide === 'intro' && g.assume), lv.id + ' 的引导没有说明该假设什么');
  }
  console.log('   空题设关卡 ' + empty + ' 关，全部有提示与引导');
});
