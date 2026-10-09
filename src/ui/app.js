// src/ui/app.js —— 游戏界面：把内核接到可点击的证明台上
import { P, termStr } from '../core/logic.js';
import { candidateSteps, pickGoalCandidate, pickCaseSplitCandidate } from './candidates.js';
import { RULES, RULE_ORDER, RuleError } from '../core/rules.js';
import { LEVELS, TIERS } from '../data/levels.js';
import { FOUND_PROOFS } from '../data/found-proofs.js';
import {
  createState, applyStep, undo, visibleFacts, matchedFact, isTrivial,
  termCandidates, instantiateAxioms, tryStep,
} from '../core/proof.js';

const $ = (id) => document.getElementById(id);
// localStorage 在某些 file:// 环境下会直接抛异常，全部包起来，失败就只是“不记进度”
const store = {
  get done() { try { return JSON.parse(localStorage.getItem('lpg.done') || '[]'); } catch (e) { return []; } },
  mark(id) { try { const d = new Set(this.done); d.add(id); localStorage.setItem('lpg.done', JSON.stringify([...d])); } catch (e) { /* 忽略 */ } },
  reset() { try { localStorage.removeItem('lpg.done'); } catch (e) { /* 忽略 */ } },
};

let state = null;
let selected = [];
let hintIndex = 0;

/* ---------------- 关卡列表 ---------------- */
function renderLevelList() {
  const box = $('level-list');
  box.innerHTML = '';
  const done = new Set(store.done);
  for (const tier of ['L0', 'L1']) {
    const head = document.createElement('div');
    head.className = 'tier-head';
    head.textContent = TIERS[tier] || tier;
    box.appendChild(head);
    for (const lv of LEVELS.filter((l) => l.tier === tier)) {
      const item = document.createElement('div');
      item.className = 'level-item' + (lv.id === state.level.id ? ' active' : '') + (done.has(lv.id) ? ' done' : '');
      item.innerHTML = '<span class="dot">' + (done.has(lv.id) ? '✔' : '○') + '</span><span>' + lv.id + ' ' + lv.title + '</span>';
      item.onclick = () => loadLevel(lv.id);
      box.appendChild(item);
    }
  }
  $('progress-text').textContent = done.size + ' / ' + LEVELS.length + ' 关';
}

/* ---------------- 载入关卡 ---------------- */
function loadLevel(id) {
  const lv = LEVELS.find((l) => l.id === id) || LEVELS[0];
  state = createState(lv);
  selected = [];
  hintIndex = 0;
  renderAll();
  setStatus('已载入 ' + lv.id + '：' + lv.title + '。先读一读上面的说明，再选前提、点规则。', '');
}

function renderAll() {
  const lv = state.level;
  $('level-title').textContent = lv.id + ' · ' + lv.title;
  $('level-tier').textContent = TIERS[lv.tier] || lv.tier;
  $('goal-text').textContent = P(state.goal);
  const ov = [...state.compiled.openVars];
  $('goal-openvars').textContent = ov.length ? '（' + ov.join('、') + ' 视为任意取定的量，可直接用于实例化公理）' : '';
  $('level-teach').textContent = lv.teach || '';
  $('level-premises').textContent = (lv.premiseText || '') + (lv.hintText ? '　提示：' + lv.hintText : '');
  renderFacts();
  renderRules();
  renderProof();
  renderAxioms();
  renderLevelList();
  if (matchedFact(state)) onSolved();
}

/* ---------------- 事实表 ---------------- */
function renderFacts() {
  const box = $('facts');
  box.innerHTML = '';
  const vis = visibleFacts(state);
  if (!vis.length) {
    // 空题设的关卡（例如“证明 A → A”）载入后一条事实都没有，
    // 必须明确告诉玩家下一步该干什么，否则界面看上去像坏的。
    const empty = document.createElement('div');
    empty.className = 'facts-empty';
    const g = state.goal;
    let tip = '本关没有题设。';
    if (g && g.k === 'imp') tip += '要证 ' + P(g) + '，请先在下方“子证明”里假设 ' + P(g.a) + '（或直接点规则区的“蕴含引入”看引导）。';
    else if (g && g.k === 'not') tip += '要证 ' + P(g) + '，请先假设 ' + P(g.a) + ' 并推出矛盾。';
    else tip += '可以先点下方“打开假设”开一个子证明，或看看规则区的引导。';
    empty.textContent = tip;
    box.appendChild(empty);
  }
  for (const f of vis) {
    const el = document.createElement('div');
    const cls = f.rule === 'assume' ? ' assume' : (f.given ? '' : ' derived');
    el.className = 'fact' + (selected.indexOf(f.id) >= 0 ? ' sel' : '') + cls;
    el.innerHTML = '<span class="id">' + escapeHtml(f.id) + '</span><span><span class="fx">' + escapeHtml(P(f.f)) +
      '</span><br><span class="meta">' + escapeHtml(factLabel(f)) + '</span></span>';
    el.onclick = () => toggleSelect(f.id);
    box.appendChild(el);
  }
  $('select-hint').textContent = '已选 ' + selected.length + ' 条' + (selected.length ? '：' + selected.join(', ') : '');
  renderScopes();
}

/* 把“当前打开的子证明”显式列出来：玩家据此知道现在处在哪一层，
   也才知道 ∨E / ↔I 这类需要合上两支的规则该收哪一层。 */
function renderScopes() {
  const box = $('scope-list');
  if (!box) return;
  const stack = state.scopeStack || [];
  box.innerHTML = '';
  if (!stack.length) {
    box.innerHTML = '<span class="scope-none">当前没有打开的子证明</span>';
    return;
  }
  stack.forEach((id, i) => {
    const sp = document.createElement('span');
    sp.className = 'scope-chip';
    const f = state.assumptions && state.assumptions[id];
    sp.textContent = (i + 1) + '. ' + id + (f ? '：' + P(f) : '');
    sp.title = '第 ' + (i + 1) + ' 层子证明，合上时收最内层';
    box.appendChild(sp);
  });
}

function factLabel(f) {
  if (f.rule === 'premise') return '题设';
  if (f.rule === 'axiom') return '公理 ' + (f.ax ? f.ax.id : '') + (f.ax && f.ax.note ? ' · ' + f.ax.note : '');
  if (f.rule === 'assume') return '子证明假设（作用域 ' + f.scope + '）';
  if (f.rule === 'hyp') return '引用前提';
  const spec = RULES[f.rule];
  const terms = (f.terms || []).map((t) => termStr(t, [])).filter(Boolean);
  return (spec ? spec.name : f.rule) + (terms.length ? ' [' + terms.join('、') + ']' : '') + (f.scope ? ' · 依赖假设 ' + f.scope : '');
}

function toggleSelect(id) {
  const i = selected.indexOf(id);
  if (i >= 0) selected.splice(i, 1); else selected.push(id);
  renderFacts();
}

/* ---------------- 规则按钮 ---------------- */
function renderRules() {
  const box = $('rules');
  box.innerHTML = '';
  const avail = (state.level.rules || []).filter((r) => RULES[r]);
  for (const rid of RULE_ORDER.filter((r) => avail.indexOf(r) >= 0)) {
    const spec = RULES[rid];
    const btn = document.createElement('button');
    btn.className = 'rule' + (rid === 'impE' || rid === 'ring' ? ' primary' : '');
    btn.textContent = spec.name;
    btn.title = spec.hint;
    btn.onclick = () => useRule(rid);
    box.appendChild(btn);
  }
}

/* ---------------- 证明记录 ---------------- */
function renderProof() {
  const box = $('proof');
  box.innerHTML = '';
  let n = 0;
  const closed = new Set(state.closedScopes || []);
  for (const f of state.facts) {
    if (f.given) continue;
    n++;
    const li = document.createElement('li');
    const spec = RULES[f.rule];
    // 子证明的层次：作用域是 "H1|H2" 就说明处在第二层
    const depth = f.scope ? String(f.scope).split('|').filter(Boolean).length : 0;
    const parts = f.scope ? String(f.scope).split('|') : [];
    const isClosed = parts.some((id) => closed.has(id));
    li.className = 'proof-line depth' + Math.min(3, depth) + (isClosed ? ' closed' : '');
    const why = f.rule === 'assume'
      ? '假设（子证明 ' + f.scope + '）'
      : (spec ? spec.name : f.rule) + (f.scope ? ' · 依赖 ' + f.scope : '');
    li.innerHTML = '<span class="fx">' + escapeHtml(P(f.f)) + '</span><span class="why">' +
      escapeHtml(why) + (isClosed ? ' · 已合上' : '') + '</span>';
    box.appendChild(li);
  }
  $('proof-hint').textContent = n + ' 步' + (state.scopeStack.length ? '（子证明 ' + state.scopeStack.length + ' 层开着）' : '');
}

/* ---------------- 公理表 ---------------- */
function renderAxioms() {
  const box = $('axioms');
  box.innerHTML = '';
  const ax = state.compiled.axioms;
  if (!ax.length) { box.textContent = '本关不需要额外公理（只用逻辑规则）。'; return; }
  const table = document.createElement('table');
  for (const a of ax) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td class="n">' + escapeHtml(a.id) + '</td><td class="f">' + escapeHtml(P(a.f)) + '</td><td class="d">' + escapeHtml(a.note || '') + '</td>';
    table.appendChild(tr);
  }
  box.appendChild(table);
}

/* ---------------- 走一步 ---------------- */
function useRule(rid) {
  const spec = RULES[rid];
  if (!spec) return;
  // 不用浏览器弹窗：由 candidates 模块算出所有成立的分支，再决定自动执行还是让玩家点选
  const cands = candidateSteps(state, rid, selected.slice());
  // 前提数量不对时，如果存在引导（例如“分情况讨论”），就先把引导给玩家看，
  // 只报“需要恰好 N 个前提”会让人卡住——他本来就需要先知道要开哪两支。
  if (spec.arity !== null && selected.length !== spec.arity) {
    if (cands.some((c) => c.guide)) { showChoices(rid, cands); return; }
    setStatus('“' + spec.name + '”需要恰好 ' + spec.arity + ' 个前提，当前选了 ' + selected.length + ' 个。' + (spec.arity === 2 ? '（按住 Ctrl 可多选）' : ''), 'warn');
    return;
  }
  if (!cands.length) {
    const probe = tryStep(state, { rule: rid, ids: selected.slice() });
    setStatus('这一步不成立：' + (probe.error || '没有可用的结果。先看看前提选对了没有。'), 'bad');
    return;
  }
  // 引导型候选（例如分情况讨论的说明）不是可执行的步骤，要单独渲染
  if (cands.every((c) => c.guide)) { showChoices(rid, cands); return; }
  const steps = cands.filter((c) => c.step);
  if (steps.length === 1) { commit(steps[0].step); return; }
  const hit = pickGoalCandidate(state, steps, state.goal) || pickCaseSplitCandidate(state, steps, state.goal);
  if (hit) { commit(hit.step); return; }
  showChoices(rid, cands);
}

/* 把候选步骤渲染成一行可选择的结果 */
function showChoices(rid, cands, base) {
  const spec = RULES[rid];
  const box = $('choices');
  box.hidden = false;
  box.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'choices-head';
  head.textContent = '“' + spec.name + '”有多种可能，点一个执行：';
  box.appendChild(head);
  // 引导型：把“每一支要推出什么”摆出来，并给一键“开始这一支”
  for (const c of cands.filter((x) => x.guide === 'caseSplit')) {
    const g = document.createElement('div');
    g.className = 'guide';
    g.innerHTML = '<div class="guide-head">' + escapeHtml(c.label) + '</div>';
    box.appendChild(g);
    for (const b of c.branches) {
      const row = document.createElement('div');
      row.className = 'guide-branch' + (b.done ? ' done' : '');
      row.innerHTML = '<span class="mark">' + (b.done ? '✓' : '·') + '</span><span>' + escapeHtml(b.text) + '</span>';
      if (!b.done) {
        const btn = document.createElement('button');
        btn.className = 'rule';
        btn.textContent = '开始这一支：假设 ' + b.assume;
        btn.onclick = () => { hideChoices(); $('assume-input').value = b.assume; openAssumption(); };
        row.appendChild(btn);
      }
      g.appendChild(row);
    }
    const tip = document.createElement('div');
    tip.className = 'guide-tip';
    tip.textContent = '两支都合上后，再选中这个析取与两条结论一起点 ∨E 就能收尾。';
    g.appendChild(tip);
  }
  // 引导型：引入类规则（→I / ¬I / ⊥C）要先开子证明——直接告诉他假设什么，并能一键打开
  for (const c of cands.filter((x) => x.guide === 'intro')) {
    const g = document.createElement('div');
    g.className = 'guide';
    g.innerHTML = '<div class="guide-head">' + escapeHtml(c.label) + '</div>';
    const row = document.createElement('div');
    row.className = 'guide-branch';
    row.innerHTML = '<span class="mark">·</span><span>子证明里要' + escapeHtml(c.need) + '</span>';
    const btn = document.createElement('button');
    btn.className = 'rule';
    btn.textContent = '开始：假设 ' + c.assume;
    btn.onclick = () => { hideChoices(); $('assume-input').value = c.assume; openAssumption(); };
    row.appendChild(btn);
    g.appendChild(row);
    if (c.hint) {
      const tip = document.createElement('div');
      tip.className = 'guide-tip';
      tip.textContent = c.hint;
      g.appendChild(tip);
    }
    box.appendChild(g);
  }
  for (const c of cands.filter((x) => x.step).slice(0, 16)) {
    const b = document.createElement('button');
    b.className = 'rule';
    b.textContent = c.label;
    b.title = '结果：' + c.label;
    b.onclick = () => { hideChoices(); commit(c.step); };
    box.appendChild(b);
  }
  // 允许自己写一个结果式（例如中间步骤 -3 ≤ 0）
  const customInput = document.createElement('input');
  customInput.placeholder = '或者自己写结果式，回车确认';
  customInput.onkeydown = () => {};
  const customBtn = document.createElement('button');
  customBtn.className = 'ghost';
  customBtn.textContent = '用我写的式子';
  customBtn.onclick = () => {
    const raw = (customInput.value || '').trim();
    if (!raw) { setStatus('请先在输入框里写出结果式。', 'warn'); return; }
    hideChoices();
    commit({ rule: rid, ids: selected.slice(), pick: base.pick, op: base.op, formula: raw });
  };
  box.appendChild(customInput);
  box.appendChild(customBtn);
  const cancel = document.createElement('button');
  cancel.className = 'ghost';
  cancel.textContent = '取消';
  cancel.onclick = () => { hideChoices(); setStatus('已取消这一步。', ''); };
  box.appendChild(cancel);
  setStatus('请在上方“候选结果”里选一个（' + cands.length + ' 种可能），也可以自己写结果式。', 'warn');
}
function hideChoices() { const b = $('choices'); b.hidden = true; b.innerHTML = ''; }

function commit(step) {
  hideChoices();
  try {
    const fact = applyStep(state, step);
    selected = [];
    hintIndex = 0;
    setStatus('✓ ' + P(fact.f) + '　（' + (RULES[fact.rule] ? RULES[fact.rule].name : fact.rule) + '）', 'ok');
    renderAll();
  } catch (e) {
    setStatus('✗ ' + (e instanceof RuleError ? e.message : String(e.message || e)), 'bad');
  }
}

/* ---------------- 假设 / 撤销 / 实例化 / 提示 ---------------- */
function openAssumption() {
  const raw = $('assume-input').value.trim();
  if (!raw) { setStatus('请先写出要假设的式子，例如 A 或 not B。', 'warn'); return; }
  commit({ assume: raw });
  $('assume-input').value = '';
}

function doUndo() {
  const last = undo(state);
  if (!last) { setStatus('没有可撤销的步骤。', 'warn'); return; }
  selected = [];
  setStatus('已撤销一步：' + P(last.f), '');
  renderAll();
}

function doInstantiate() {
  const created = instantiateAxioms(state, 400);
  setStatus(created.length ? '自动实例化了 ' + created.length + ' 条公理实例，已放进上面的“可用事实”。' : '没有新的可实例化公理（可能已经展开过）。', created.length ? 'ok' : 'warn');
  renderAll();
}

function doHint() {
  const lv = state.level;
  if (matchedFact(state)) { setStatus('这一关已经完成啦，可以点左边继续下一关。', 'ok'); return; }
  // 提示来源：优先手写标准证明，没有就用解算器自动搜到的证明
  const found = FOUND_PROOFS[lv.id];
  const plan = (lv.script && !lv.noScript) ? lv.script : (found ? found.steps : null);
  const fromSolver = !(lv.script && !lv.noScript) && !!found;
  if (!plan) {
    setStatus('本题是开放练习，解算器也还没搜出证明。' + (lv.scriptNote || '') + '　建议：先“展开全称公理”，再用 ∀E 与 →E 逐步推进。', 'warn');
    return;
  }
  const step = plan[hintIndex];
  if (!step) {
    setStatus('提示已经用完了。' + (lv.scriptNote || ''), 'warn');
    return;
  }
  const tag = fromSolver ? '（自动搜出的证明）' : '';
  setStatus('提示 ' + (hintIndex + 1) + '/' + plan.length + tag + '：' + describeStep(step), 'warn');
  hintIndex++;
}

function describeStep(step) {
  if (step.assume !== undefined) return '打开子证明，假设 ' + step.assume;
  const spec = RULES[step.rule];
  const ids = (step.ids || []).join(', ');
  const extra = [
    step.term ? '项 ' + step.term : '',
    step.pick ? '选择 ' + step.pick : '',
    step.formula ? '结果式 ' + step.formula : '',
    step.op ? '运算 ' + step.op.name + (step.op.n !== undefined ? ' ' + step.op.n : '') : '',
  ].filter(Boolean).join('，');
  return '选 ' + (ids || '（无前提）') + ' → 点“' + (spec ? spec.name : step.rule) + '”' + (extra ? '（' + extra + '）' : '');
}

function setStatus(msg, kind) {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status' + (kind === 'ok' ? ' ok' : kind === 'bad' ? ' bad' : kind === 'warn' ? ' warn' : '');
}

function onSolved() {
  const id = state.level.id;
  const first = store.done.indexOf(id) < 0;
  store.mark(id);
  if (first) setStatus('🎉 完成 ' + id + '！结论已推出：' + P(state.goal), 'ok');
  renderLevelList();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- 事件绑定 ---------------- */
$('btn-assume').onclick = openAssumption;
$('assume-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') openAssumption(); });
$('btn-undo').onclick = doUndo;
$('btn-instantiate').onclick = doInstantiate;
$('btn-hint').onclick = doHint;
$('btn-reset').onclick = () => { store.reset(); renderLevelList(); setStatus('本地进度已清空。', ''); };
$('btn-axioms').onclick = () => { const a = $('axioms'); a.hidden = !a.hidden; };

/* ---------------- 测试钩子（供无浏览器冒烟测试调用） ---------------- */
export function debugState() { return state; }
export function debugLevelId() { return state && state.level.id; }
export function debugGoalText() { return $('goal-text').textContent; }
export function debugStatusText() { return $('status').textContent; }
export function debugSolved() { return !!matchedFact(state); }
export function debugSelect(ids) { selected = ids.slice(); renderFacts(); }
export function debugUseRule(rid) { useRule(rid); }
export function debugAssumption(raw) { $('assume-input').value = raw; openAssumption(); }
export function debugHint() { doHint(); }
/* 走“界面的真实路径”：设置选择 → useRule（含候选计算与自动挑选） */
export function debugSelectAndUse(ids, rid) {
  selected = ids.slice();
  renderFacts();
  useRule(rid);
  return debugStatusText();
}
/* 当前可见的事实（id → 公式文本） */
export function debugFacts() {
  return visibleFacts(state).map((f) => ({ id: f.id, text: P(f.f), rule: f.rule, scope: f.scope }));
}
/* 当前打开的子证明层数 */
export function debugScopes() { return (state.scopeStack || []).slice(); }
/* 当前候选（不执行） */
export function debugCandidates(ids, rid) {
  return candidateSteps(state, rid, ids.slice()).map((c) => c.label);
}
/* 候选里有没有“引导型”（分情况讨论 / 开子证明的说明） */
export function debugGuides(ids, rid) {
  return candidateSteps(state, rid, ids.slice())
    .filter((c) => c.guide)
    .map((c) => ({
      guide: c.guide,
      label: c.label,
      assume: c.assume,
      need: c.need,
      branches: (c.branches || []).map((b) => b.text),
    }));
}
/* 候选面板里渲染出来的按钮文字（走的是真实渲染路径） */
export function debugChoiceButtons() {
  const box = $('choices');
  if (!box) return [];
  const out = [];
  const walk = (el) => {
    if (!el) return;
    if (el.tagName === 'BUTTON') out.push(el.textContent || '');
    for (const c of el.children || []) walk(c);
  };
  walk(box);
  return out;
}
/* 可用事实面板里的文字（含空状态提示） */
export function debugFactsText() {
  const box = $('facts');
  if (!box) return '(没有 facts 容器)';
  const out = [];
  const walk = (el, d) => {
    if (!el || d > 5) return;
    out.push('  '.repeat(d) + (el.tagName || '?') + (el.className ? '.' + el.className : '') + ' :: ' + (el.textContent || el._html || ''));
    for (const c of el.children || []) walk(c, d + 1);
  };
  walk(box, 0);
  return out.join('\n');
}

/* 候选面板里的文字内容（诊断用） */
export function debugChoicesText() {
  const box = $('choices');
  if (!box) return '(没有 choices 容器)';
  const out = [];
  const walk = (el, d) => {
    if (!el || d > 5) return;
    out.push('  '.repeat(d) + (el.tagName || '?') + (el.className ? '.' + el.className : '') + ' :: ' + (el.textContent || el._html || ''));
    for (const c of el.children || []) walk(c, d + 1);
  };
  walk(box, 0);
  return out.join('\n');
}

/* 点击候选面板里第 i 个按钮 */
export function debugClickChoice(i) {
  const box = $('choices');
  const btns = [];
  const walk = (el) => {
    if (!el) return;
    if (el.tagName === 'BUTTON') btns.push(el);
    for (const c of el.children || []) walk(c);
  };
  walk(box);
  const b = btns[i];
  if (!b) return false;
  if (b.onclick) b.onclick();
  return true;
}
export function debugDescribe(step) { return describeStep(step); }
export { loadLevel };

loadLevel(LEVELS[0].id);
