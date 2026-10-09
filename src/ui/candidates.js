// ui/candidates.js —— “这一步有哪些可能的结果”：与 DOM 无关，可单独测试
import { P, termStr, alphaEq, fkey, termKey } from '../core/logic.js';
import { termCandidates, visibleFacts, tryStep } from '../core/proof.js';

/* 收集一组公式的所有子公式（去重） */
export function subformulasOf(formulas) {
  const out = [];
  const push = (f) => { if (!out.some((x) => alphaEq(x, f))) out.push(f); };
  const walk = (f, depth) => {
    if (depth > 3) return;
    push(f);
    switch (f.k) {
      case 'not': walk(f.a, depth + 1); break;
      case 'and': case 'or': case 'imp': case 'iff': walk(f.a, depth + 1); walk(f.b, depth + 1); break;
      case 'all': case 'ex': walk(f.body, depth + 1); break;
      default: break;
    }
  };
  for (const f of formulas) walk(f, 0);
  return out;
}

/* ∀E 可代入的项：先取目标/题设中出现的项，再补充常用变量 */
export function allETerms(state, limit = 14) {
  const seen = new Map();
  const add = (t, label) => { const k = label || termStr(t, []); if (!seen.has(k)) seen.set(k, { term: t, label: k }); };
  for (const c of termCandidates(state)) add(c.term, c.label);
  for (const n of ['x', 'y', 'z', 'a', 'b', 'c', '0', '1', '2']) add({ k: 'v', name: n, free: true }, n);
  return [...seen.values()].slice(0, limit);
}

/* 两边同时运算的候选 */
export function eqOpCandidates() {
  const out = [];
  for (const n of [1, 2, 3]) {
    out.push({ op: { name: 'add', n }, label: '两边同加 ' + n });
    out.push({ op: { name: 'sub', n }, label: '两边同减 ' + n });
    out.push({ op: { name: 'mul', n }, label: '两边同乘 ' + n });
    out.push({ op: { name: 'div', n }, label: '两边同除以 ' + n });
  }
  out.push({ op: { name: 'neg' }, label: '两边同时取负' });
  out.push({ op: { name: 'sq' }, label: '两边同时平方' });
  return out;
}

/**
 * 生成“点某条规则”时所有成立的候选步骤。
 * 内部一律用 tryStep 在状态副本上试算，只有内核真正接受的步骤才会出现在候选里，
 * 因此界面永远做不出错误的一步。
 */
export function candidateSteps(state, rid, ids) {
  const idList = (ids || []).slice();
  const base = { rule: rid, ids: idList };
  const cands = [];
  const seen = new Set();
  const addCand = (step, label, extra) => {
    const r = tryStep(state, step);
    if (!r.ok) return;
    const key = rid + '|' + fkey(r.fact.f) + '|' + (label || '');
    if (seen.has(key)) return;
    seen.add(key);
    cands.push({ step, label: label || P(r.fact.f), result: P(r.fact.f), ...(extra || {}) });
  };
  const itemOf = (id) => state.facts.find((f) => f.id === id);
  const firstF = (id) => (itemOf(id) ? itemOf(id).f : state.goal);
  const isEq = (f) => f && f.k === 'eq';
  const visible = visibleFacts(state);

  switch (rid) {
    case 'andE':
      addCand({ ...base, pick: '左' }, '取左边');
      addCand({ ...base, pick: '右' }, '取右边');
      break;
    case 'iffE':
      addCand({ ...base, pick: '→' }, '取 → 方向');
      addCand({ ...base, pick: '←' }, '取 ← 方向');
      break;
    case 'eqRewrite': {
      // 等式代换：把每条可见等式（以及已推导事实里的等式）两个方向 × 等式两侧都试一遍，
      // 成立的替换结果都列出来，玩家点一个即可——不再要求他手写结果式。
      const eqs = [];
      const pushEq = (f, id, tag) => { if (isEq(f)) eqs.push({ f, id, tag }); };
      for (const f of visible) {
        pushEq(f.f, f.id, f.id);
        for (const t of (f.terms || [])) { /* 已用项不参与代换 */ }
        for (const sub of subformulasOf([f.f])) pushEq(sub, f.id, f.id + ' 中的 ' + P(sub));
      }
      for (const e of eqs) {
        for (const [from, to, dirTag] of [[e.f.a, e.f.b, '→'], [e.f.b, e.f.a, '←']]) {
          for (const side of ['左', '右', '任意']) {
            const step = { rule: rid, ids: [e.id], pick: side === '任意' ? undefined : side };
            // 目标式自己作为待替换公式：用 (等式, 目标) 两个前提
            const target = state.goal;
            const full = { rule: rid, ids: [e.id], pick: side === '任意' ? undefined : side, formula: undefined };
            // 直接尝试“把等式应用到某个已推导事实/目标上”
            for (const cand of rewriteAgainst(e.id, e.f, from, to, side)) addCand(cand, cand.__label);
          }
        }
      }
      // 兜底：若调用者已经选好了两个前提，直接按所选前提生成
      if (idList.length === 2) addCand(base, '按所选前提代换');
      break;
    }
    case 'allE':
      for (const c of allETerms(state)) addCand({ ...base, term: c.term }, '代入 ' + c.label);
      break;
    case 'exI':
      for (const c of termCandidates(state)) addCand({ ...base, term: c.term }, '见证 ' + c.label);
      break;
    case 'excludedMiddle': {
      // 排中律要写清楚“对哪个命题取排中”：把所有可能的 A ∨ ¬A 都列出来
      const pool = [state.goal].concat(visible.map((f) => f.f));
      for (const sub of subformulasOf(pool)) {
        if (sub.k === 'not' || sub.k === 'or') continue;   // 取排中的通常是原子或蕴含这种“命题”
        const left = { k: 'or', a: sub, b: { k: 'not', a: sub } };
        const right = { k: 'or', a: { k: 'not', a: sub }, b: sub };
        // 标出“被取排中的那个命题”，便于按目标挑出该用哪一个
        addCand({ ...base, formula: left }, '对 ' + P(sub) + ' 用排中律：' + P(left), { caseSplitOn: sub });
        addCand({ ...base, formula: right }, '对 ' + P(sub) + ' 用排中律：' + P(right), { caseSplitOn: sub });
      }
      break;
    }
    case 'eqOp':
      for (const c of eqOpCandidates()) addCand({ ...base, op: c.op }, c.label);
      break;
    case 'eqRefl':
      for (const c of termCandidates(state)) addCand({ ...base, term: c.term }, '取 ' + c.label);
      break;
    case 'orI': {
      const a = firstF(idList[0]);
      const others = [];
      if (state.goal.k === 'or') {
        if (alphaEq(state.goal.a, a)) others.push(state.goal.b);
        if (alphaEq(state.goal.b, a)) others.push(state.goal.a);
      }
      for (const sub of subformulasOf([state.goal].concat(visible.map((f) => f.f)))) {
        if (!alphaEq(sub, a)) others.push(sub);
      }
      for (const other of others) addCand({ ...base, formula: { k: 'or', a, b: other } }, P({ k: 'or', a, b: other }));
      break;
    }
    case 'orE': {
      // 分情况讨论的引导：玩家选了析取却没给两支结论时，不能只报“前提数量不对”，
      // 而要告诉他这两支各自要推出什么、已经推到哪一步了。
      if (idList.length === 1) {
        const disj = itemOf(idList[0]);
        if (disj && disj.f.k === 'or' && state.goal) {
          const g = state.goal;
          const has = (f) => visible.some((v) => alphaEq(v.f, f));
          const branchText = (t) => (alphaEq(t, g) ? P(t) + '（就是目标）' : P(t) + '，再用它合上子证明');
          cands.push({
            guide: 'caseSplit',
            label: '分情况讨论：' + P(disj.f.a) + ' 与 ' + P(disj.f.b) + ' 两支都要推出 ' + P(g),
            branches: [disj.f.a, disj.f.b].map((t) => ({
              assume: P(t),
              need: P(g),
              done: has(g),
              text: '假设 ' + P(t) + ' 后推出 ' + branchText(g),
            })),
            ready: has(g),
          });
          break;
        }
      }
      addCand(base, base.label);
      break;
    }
    case 'impI': case 'negI': case 'raa': {
      // 引入类规则必须先开子证明。玩家什么都没选时，只报“需要恰好 1 个前提”会让人卡住——
      // 他需要的是“该假设什么”。这里把该开的子证明直接摆出来，并可一键打开。
      if (idList.length === 0 && state.goal && !visible.some((f) => f.rule === 'assume')) {
        const g = state.goal;
        const plan = introPlan(rid, g);
        if (plan) {
          cands.push({
            guide: 'intro',
            label: plan.label,
            assume: P(plan.assume),
            need: plan.needText,
            hint: plan.hint,
          });
          break;
        }
      }
      addCand(base, base.label);
      break;
    }
    case 'impE': case 'andI': case 'negE': case 'eqSym': case 'eqTrans':
    case 'iffI': case 'hyp':
      addCand(base, base.label);
      break;
    case 'ring': case 'arith': {
      if (idList.length) { addCand(base, '对所选前提'); break; }
      const pool = [state.goal].concat(visible.map((f) => f.f));
      const seenF = [];
      const tryFormula = (f, tag) => {
        const k = fkey(f);
        if (seenF.indexOf(k) >= 0) return;
        seenF.push(k);
        addCand({ ...base, formula: f }, tag);
      };
      tryFormula(state.goal, '对目标式 ' + P(state.goal));
      for (const f of pool) {
        // 公式里“两边都是具体数字”的部分，本身就是一个可判定的中间结论
        for (const part of concreteParts(f)) tryFormula(part, '对 ' + P(part));
      }
      for (const sub of subformulasOf(pool)) {
        if (sub.k === 'eq') tryFormula(sub, '对 ' + P(sub));
        if (sub.k === 'atom' && ['lt', 'le', 'gt', 'ge'].indexOf(sub.name) >= 0) tryFormula(sub, '对 ' + P(sub));
      }
      break;
    }
    default:
      addCand(base, base.label);
  }
  return cands;

  /* 把某条等式在“目标”与所有自由出现的事实上做替换，收集成立的结果 */
  function rewriteAgainst(eqId, eqF, from, to, side) {
    const out = [];
    const targets = [state.goal].concat(visible.filter((f) => !f.given).map((f) => f.f));
    // 目标本身没有前提 id 可引用，因此只处理“已有事实”上的代换
    for (const f of visible) {
      if (f.id === eqId) continue;
      const ids2 = idList.length === 2 ? [idList[0], idList[1]] : [eqId, f.id];
      const step = { rule: 'eqRewrite', ids: ids2 };
      if (side !== '任意') step.pick = side;
      const r = tryStep(state, step);
      if (!r.ok) continue;
      out.push({ ...step, __label: '由 ' + P(eqF) + ' 得到 ' + P(r.fact.f) });
    }
    return out;
  }
}

/* 找出公式里“两边都能算出具体数字”的子式（如 |-3| = -(-3) 里的 -(-3) = 3） */
function concreteParts(f) {
  const out = [];
  const num = (t) => evalNumber(t) !== null;
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.k === 'eq' && num(node.a) && num(node.b)) out.push({ k: 'eq', a: { k: 'n', n: evalNumber(node.a) }, b: { k: 'n', n: evalNumber(node.b) } });
    if (node.k === 'atom' && ['lt', 'le', 'gt', 'ge'].indexOf(node.name) >= 0 && num(node.args[0]) && num(node.args[1])) {
      out.push({ k: 'atom', name: node.name, args: [{ k: 'n', n: evalNumber(node.args[0]) }, { k: 'n', n: evalNumber(node.args[1]) }] });
    }
    if (node.k === 'not') visit(node.a);
    if (node.a) visit(node.a);
    if (node.b) visit(node.b);
  };
  visit(f);
  return out;
}
function evalNumber(t) {
  if (t.k === 'n') return t.n;
  if (t.k !== 'c') return null;
  const a = t.args.map(evalNumber);
  if (a.some((x) => x === null)) return null;
  switch (t.name) {
    case 'add': return a[0] + a[1];
    case 'sub': return a[0] - a[1];
    case 'mul': return a[0] * a[1];
    case 'div': return a[1] === 0 ? null : a[0] / a[1];
    case 'neg': return -a[0];
    case 'sq': return a[0] * a[0];
    case 'pow': return Math.pow(a[0], a[1]);
    case 'abs': return Math.abs(a[0]);
    default: return null;
  }
}

/** 在候选里挑“结果正好是目标”的那个（界面据此自动执行） */
export function pickGoalCandidate(state, cands, goal) {
  for (const c of cands) {
    const r = tryStep(state, c.step);
    if (r.ok && alphaEq(r.fact.f, goal)) return c;
  }
  return null;
}

/* 引入类规则该开哪个子证明：→I 假设前件、¬I 假设肯定式、⊥C 假设目标的否定 */
export function introPlan(rid, goal) {
  if (rid === 'impI' && goal.k === 'imp') {
    return {
      assume: goal.a,
      label: '要证 ' + P(goal) + '：假设 ' + P(goal.a) + '，推出 ' + P(goal.b) + '，再合上子证明',
      needText: '推出 ' + P(goal.b),
      hint: '两支都做完后，选中子证明里的结论点“蕴含引入 →I”。',
    };
  }
  if (rid === 'negI' && goal.k === 'not') {
    return {
      assume: goal.a,
      label: '要证 ' + P(goal) + '：假设 ' + P(goal.a) + '，推出矛盾 ⊥，再合上子证明',
      needText: '推出 ⊥',
      hint: '在子证明里用“否定消去 ¬E”把 A 与 ¬A 撞成 ⊥。',
    };
  }
  if (rid === 'raa') {
    return {
      assume: { k: 'not', a: goal },
      label: '要证 ' + P(goal) + '：反证法——假设 ' + P({ k: 'not', a: goal }) + '，推出矛盾 ⊥',
      needText: '推出 ⊥',
      hint: '在子证明里推出矛盾后，选中 ⊥ 点“反证法 ⊥C”。',
    };
  }
  return null;
}

/* 分情况讨论：目标形如 A ∨ B 时，就该“对 A 取排中”（A ∨ ¬A）或“对 ¬B 取排中”，
   这样两支正好各自把目标的一支交出来。 */
export function pickCaseSplitCandidate(state, cands, goal) {
  if (!goal || goal.k !== 'or') return null;
  const isNegOf = (f, t) => f && f.k === 'not' && alphaEq(f.a, t);
  // 只有当“目标的某一支正好是 t 的否定”时，对 t 取排中才真的有用：
  // 那一支由 ¬t 的子证明交出，另一支由“t → 目标另一支”交出。
  // 注意 A ∨ ¬A 与 ¬A ∨ A 两种写法都会命中，要按 t 去重后再判断是否唯一。
  const targets = [];
  for (const c of cands) {
    const t = c.caseSplitOn;
    if (!t) continue;
    if (!(isNegOf(goal.a, t) || isNegOf(goal.b, t))) continue;
    if (!targets.some((x) => alphaEq(x, t))) targets.push(t);
  }
  if (targets.length !== 1) return null;
  const t = targets[0];
  // 优先选“A ∨ ¬A”这种把 t 放前面的写法（和目标那一支的次序更接近）
  return cands.find((c) => c.caseSplitOn && alphaEq(c.caseSplitOn, t)) || null;
}
