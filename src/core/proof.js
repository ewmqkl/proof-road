// core/proof.js —— 证明状态机：把关卡、公理、规则串起来
import { parse, parseTerm, alphaEq, fstr, termStr, eq, atom } from './logic.js';
import { runRule, makeFact, RULES, RuleError, evalConcrete } from './rules.js';
import { compileLevel } from './level-utils.js';

/* 关卡 -> 初始证明状态 */
export function createState(level) {
  const compiled = level.sig ? level : compileLevel(level);
  const state = {
    level: compiled,
    compiled,
    facts: [],
    nextId: 1,
    assumeCount: 0,
    assumptions: {},
    scopeStack: [],
    closedScopes: [],     // 已经合上的子证明：界面据此把它们画成灰的，不再可选
    goal: compiled.goal,
    solved: false,
  };
  compiled.parsedPremises.forEach((p, i) => {
    state.facts.push({ id: 'p' + (i + 1), f: p.f, rule: 'premise', from: [], scope: null, src: p.src, given: true });
  });
  compiled.axioms.forEach((ax) => {
    state.facts.push({ id: 'ax:' + ax.id, f: ax.f, rule: 'axiom', from: [], scope: null, ax, given: true });
  });
  return state;
}

const termOf = (state, t) => (typeof t === 'string' ? parseTerm(t, state.compiled.sig, state.compiled.pOpts) : t);

/* 深拷贝证明状态：用于“试算”候选步骤，绝不污染真实状态 */
export function cloneState(state) {
  return {
    level: state.level, compiled: state.compiled, goal: state.goal, solved: state.solved,
    facts: state.facts.map((f) => ({ ...f })),
    nextId: state.nextId,
    assumeCount: state.assumeCount,
    assumptions: { ...state.assumptions },
    scopeStack: state.scopeStack.slice(),
    closedScopes: (state.closedScopes || []).slice(),
  };
}

/* 在副本上试一步：{ok:true, fact} 或 {ok:false, error} */
export function tryStep(state, step) {
  const copy = cloneState(state);
  try {
    const fact = applyStep(copy, step);
    return { ok: true, fact, state: copy };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* 统一步骤格式：{rule,ids,term,pick,formula} | {assume} | {lemma,terms} */
export function applyStep(state, step) {
  // formula / term / assume 都允许写成字符串：关卡脚本与提示里这样写可读性好得多
  if (step && typeof step.formula === 'string') step = { ...step, formula: parse(step.formula, state.compiled.sig, state.compiled.pOpts) };
  if (step && step.term !== undefined && step.term !== null && typeof step.term === 'string') step = { ...step, term: parseTerm(step.term, state.compiled.sig, state.compiled.pOpts) };
  if (step.assume !== undefined) {
    const f = typeof step.assume === 'string' ? parse(step.assume, state.compiled.sig, state.compiled.pOpts) : step.assume;
    const id = step.id || ('H' + (++state.assumeCount));
    if (step.id) state.assumeCount++;
    state.assumptions[id] = f;
    const fact = { id, f, rule: 'assume', from: [], scope: id, label: step.label };
    state.facts.push(fact);
    state.scopeStack.push(id);
    return fact;
  }
  if (step.lemma !== undefined) {
    const ax = state.compiled.axioms.find((a) => a.id === step.lemma);
    if (!ax) throw new RuleError('找不到公理 ' + step.lemma);
    let cur = state.facts.find((f) => f.id === 'ax:' + ax.id);
    const terms = step.terms || [];
    terms.forEach((tsrc, i) => {
      const res = runRule(state, { rule: 'allE', ids: [cur.id], term: termOf(state, tsrc) });
      cur = makeFact(state, res, [cur.id]);
      if (step.ids && i === terms.length - 1) cur.id = step.ids;
    });
    if (step.id) cur.id = step.id;
    return cur;
  }
  const req = { rule: step.rule, ids: (step.ids || []).slice(), term: step.term, formula: step.formula, pick: step.pick, op: step.op };
  if (typeof req.term === 'string') req.term = termOf(state, req.term);
  if (typeof req.formula === 'string') req.formula = parse(req.formula, state.compiled.sig, state.compiled.pOpts);
  if (step.rule === 'ring' || step.rule === 'arith') {
    if (req.ids.length === 0) {
      // 允许直接给出“要证明的式子”：先造一个自反的种子式，再由规则化简/判定
      const f = req.formula;
      if (!f) throw new RuleError('代数化简/数值计算需要给出目标式子或选择一个前提');
      let seed = null;
      if (f.k === 'eq') seed = eq(f.a, f.a);
      else if (f.k === 'atom' && ['lt', 'le', 'gt', 'ge'].indexOf(f.name) >= 0) seed = atom(f.name, f.args[0], f.args[0]);
      else if (f.k === 'not' && f.a.k === 'eq') seed = f;
      if (!seed) throw new RuleError('代数化简/数值计算支持等式、不等式与“不等于”');
      if (f.k !== 'eq') {
        // 不等式/不等于：先判定真伪，再把该具体命题登记为一条结果
        const rel = f.k === 'not' ? f.a : f;
        const a = evalConcrete(rel.args[0]), b = evalConcrete(rel.args[1]);
        if (a === null || b === null) throw new RuleError('数值计算：两边必须都是具体数字');
        if (f.k === 'not') {
          if (a === b) throw new RuleError('数值计算：' + a + ' = ' + b + '，不能断言不等');
        } else {
          const ok = f.name === 'lt' ? a < b : f.name === 'le' ? a <= b : f.name === 'gt' ? a > b : a >= b;
          if (!ok) throw new RuleError('数值计算：' + a + ' 与 ' + b + ' 不满足该关系');
        }
        const fact = makeFact(state, { f, rule: 'arith', terms: [], scope: null }, []);
        if (step.id) fact.id = step.id;
        return fact;
      }
      // 等式：若玩家直接给出了具体数值等式（如 |-3| = 3），直接判定真伪
      const la = evalConcrete(f.a), lb = evalConcrete(f.b);
      if (la !== null && lb !== null) {
        if (la !== lb) throw new RuleError('数值计算：' + la + ' ≠ ' + lb);
        const fact = makeFact(state, { f, rule: 'arith', terms: [], scope: null }, []);
        if (step.id) fact.id = step.id;
        return fact;
      }
      const refl = makeFact(state, { f: seed, rule: 'eqRefl', terms: [], scope: null }, []);
      req.ids = [refl.id];
    }
    const res = runRule(state, req);
    const fact = makeFact(state, res, req.ids);
    if (step.id) fact.id = step.id;
    syncScopes(state);
    return fact;
  }
  const res = runRule(state, req);
  const fact = makeFact(state, res, req.ids);
  if (step.id) fact.id = step.id;
  syncScopes(state);
  return fact;
}

// 规则合上子证明后，同步作用域栈（弹掉已关闭的假设）
export function syncScopes(state) {
  const open = new Set();
  for (const f of state.facts) {
    if (!f.scope) continue;
    for (const s of String(f.scope).split('|')) if (s) open.add(s);
  }
  // 事实若依赖了“已不在假设表里”的假设，就作废（子证明结束后不能再引用）
  state.facts = state.facts.filter((f) => {
    if (!f.scope) return true;
    return String(f.scope).split('|').every((id) => state.assumptions[id] !== undefined);
  });
  state.scopeStack = state.scopeStack.filter((id) => state.assumptions[id] !== undefined);
}

/* 运行证明脚本（测试 / 提示 / 自动演示） */
export function runScript(level, script) {
  const state = createState(level);
  const steps = [];
  try {
    for (const step of script) {
      const fact = applyStep(state, step);
      steps.push({ step, fact });
    }
  } catch (e) {
    return { state, steps, ok: false, error: e.message, solved: false };
  }
  return { state, steps, ok: true, solved: goalReached(state), matched: matchedFact(state) };
}

export function goalReached(state) { return !!matchedFact(state); }
export function matchedFact(state) {
  // 只有“推导出来的”事实才算完成：题设/公理本身不能算证完（除非目标就是它，见 isTrivial）
  return state.facts.find((f) => !f.scope && !f.given && alphaEq(f.f, state.goal)) || null;
}
export function isTrivial(level) {
  const st = createState(level);
  return st.facts.some((f) => alphaEq(f.f, st.goal));
}

/* 撤销 / 作用域 */
export function undo(state) {
  const last = state.facts.pop();
  if (!last) return null;
  if (last.rule === 'assume') {
    delete state.assumptions[last.scope];
    const i = state.scopeStack.indexOf(last.scope);
    if (i >= 0) state.scopeStack.splice(i, 1);
  }
  return last;
}
export function visibleFacts(state) {
  // 注意：一个事实可能同时依赖多层假设，作用域写成 "H1|H2"。
  // 必须逐段判断是否还在作用域栈里，不能拿整串去比（否则嵌套子证明里的事实会全部消失）。
  return state.facts.filter((f) => {
    if (!f.scope) return true;
    return String(f.scope).split('|').every((id) => !id || state.scopeStack.indexOf(id) >= 0);
  });
}
export function openScopes(state) { return state.scopeStack.slice(); }
export function assumptionOf(state, scopeId) { return state.assumptions[scopeId]; }

/* 生成“可点击的项”：来自目标与已有事实中出现的变量/函数 */
export function termCandidates(state) {
  const seen = new Map();
  // 关键：项在公式里可能位于量词之下，打印时必须带上绑定名上下文，
  // 否则 x3 + (x2 + x1) 这种“合成变量名”会直接显示给玩家。
  const add = (t, ctx) => {
    const label = termStr(t, ctx);
    if (!seen.has(label)) seen.set(label, { label, term: t });
  };
  const walkTerm = (t, ctx) => {
    add(t, ctx);
    if (t.k === 'c') t.args.forEach((a) => walkTerm(a, ctx));
  };
  const walk = (f, ctx) => {
    switch (f.k) {
      case 'atom': f.args.forEach((t) => walkTerm(t, ctx)); break;
      case 'eq': walkTerm(f.a, ctx); walkTerm(f.b, ctx); break;
      case 'not': walk(f.a, ctx); break;
      case 'and': case 'or': case 'imp': case 'iff': walk(f.a, ctx); walk(f.b, ctx); break;
      case 'all': case 'ex': walk(f.body, [f.name].concat(ctx)); break;
    }
  };
  walk(state.goal, []);
  for (const f of visibleFacts(state)) {
    walk(f.f, []);
    for (const t of (f.terms || [])) walkTerm(t, []);   // 已经用过的项也留着，便于继续推
  }
  return [...seen.values()];
}

/* 自动实例化：把全称公理用候选项实例化一层（供“展开公理”按钮） */
export function instantiateAxioms(state, limit = 240) {
  const cands = termCandidates(state).map((c) => c.term);
  const created = [];
  for (const fact of state.facts.slice()) {
    if (fact.f.k !== 'all') continue;
    for (const t of cands) {
      if (state.facts.length + created.length > limit) break;
      try {
        const res = runRule(state, { rule: 'allE', ids: [fact.id], term: t });
        const dup = state.facts.some((f) => alphaEq(f.f, res.f)) || created.some((f) => alphaEq(f.f, res.f));
        if (dup) continue;
        created.push(makeFact(state, res, [fact.id]));
      } catch (e) { /* 跳过 */ }
    }
  }
  return created;
}
