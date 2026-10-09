// core/solver.js —— 自动搜证明：反向链接 + 迭代加深 + 成本预算
// 搜出来的每一步都立刻用内核 runRule 验证，因此“搜到了”就等于“内核接受”。
import { P, fkey, termKey, alphaEq, BOT, not } from './logic.js';
import { runRule, makeFact, RULES, RuleError } from './rules.js';
import { applyStep, matchedFact } from './proof.js';
import { parse } from './logic.js';
import { moves, termUniverse } from './tactics.js';

export function findProof(level, options = {}) {
  const maxDepth = options.maxDepth || 9;
  const budgetTotal = options.budget || 30000;
  const budget = { nodes: 0, total: budgetTotal, start: Date.now(), ms: options.timeMs || 20000 };
  const stats = { tries: 0, deepest: 0 };
  let lastUnverified = null;

  for (let depth = 1; depth <= maxDepth; depth++) {
    const state = freshState(level);
    state.goal = level.goal;
    const env = {
      state,
      facts: [],                       // 解算器推导出的事实（会在 SAT 里累积）
      scope: [],                       // 打开的子证明栈
      sys: { n: 0 },
      usedAllI: false,      // 是否用到内核没有的 ∀I（用到就不采用）
      instSeen: new Set(),  // 已实例化过的 (公理, 项) 组合，避免闭包反复做同样的工作
      instSeenTop: new Set(),
      derivations: [],      // 所有闭包推导（子证明内的会内联进 steps）
      topDerivations: [],   // 只含顶层闭包推导：验证时先重放，id 才能对上
      assumeCount: 0,
      uid: 1,          // 单调递增的 id 计数器：回溯时不回收，保证不同子证明的假设 id 不撞车
      stats,
    };
    const r = prove(env, [state.goal], depth, budget);   // 目标直接是公式，不要再包一层
    if (r.ok && !env.usedAllI) {
      // 最后一道保险：把计划在干净状态上重放，确认最后真的得到目标
      if (globalThis.__SOLVER_DEBUG && !globalThis.__QUIET_PLAN) {
        console.log('  [计划] 顶层推导 ' + env.topDerivations.length + ' 条；步骤:');
        r.steps.forEach((s, i) => console.log('    ' + (i + 1) + ': ' + JSON.stringify(s.step).slice(0, 140)));
      }
      if (verifyPlan(level.compiled || level, env.topDerivations, r.steps)) {
        return { ok: true, steps: r.steps, depth, nodes: budget.nodes, ms: Date.now() - budget.start, stats, derivations: env.topDerivations };
      }
      // 这一深度的计划没过校验：不要就此放弃，继续加深再试（并记下来供诊断）
      lastUnverified = { steps: r.steps, depth };
    }
    if (budget.nodes >= budget.total || Date.now() - budget.start > budget.ms) {
      return { ok: false, reason: '超出预算（已探索 ' + budget.nodes + ' 个节点）', nodes: budget.nodes, ms: Date.now() - budget.start, stats };
    }
  }
  return {
    ok: false,
    reason: lastUnverified
      ? '在深度 ' + maxDepth + ' 内没找到通过校验的证明（有 ' + lastUnverified.steps.length + ' 步的候选计划未通过）'
      : '在深度 ' + maxDepth + ' 内没找到证明',
    nodes: budget.nodes, ms: Date.now() - budget.start, stats,
  };
}

/* 从（已编译的）关卡起一个干净状态：题设 + 公理 */
export function freshState(compiled) {
  const state = {
    level: compiled, compiled, goal: compiled.goal,
    facts: [], nextId: 1, assumeCount: 0, assumptions: {}, scopeStack: [],
  };
  // 说明：假设 id 由 assumeCount 生成（H1、H2…），与重放时的状态机一致
  (compiled.parsedPremises || []).forEach((p, i) => {
    state.facts.push({ id: 'p' + (i + 1), f: p.f, rule: 'premise', from: [], scope: null, src: p.src, given: true });
  });
  (compiled.axioms || []).forEach((ax) => {
    state.facts.push({ id: 'ax:' + ax.id, f: ax.f, rule: 'axiom', from: [], scope: null, ax, given: true });
  });
  return state;
}

/* 核心递归：证明 targets 里的每个目标；返回 { ok, steps, emitted } */
function prove(env, rawTargets, depth, budget) {
  // 招法里的子目标可能带作用域信息，形如 { f, scope }；这里统一解包成公式
  const targets = rawTargets.map((t) => (t && t.k ? t : t.f));
  if (targets.length === 0) return { ok: true, steps: [] };
  const goal = targets[0];
  const rest = targets.slice(1);
  if (budget.nodes++ > budget.total) return { ok: false, reason: 'budget' };
  if (Date.now() - budget.start > budget.ms) return { ok: false, reason: 'timeout' };
  if (depth < 0) return { ok: false, reason: 'depth' };

  const ctx = { state: env.state, scope: env.scope.map((s) => s.id).join('|'), sys: env.sys, facts: env.facts };
  // 必须先把候选全部生成出来：moves() 是生成器，而 tryMove 会改动状态，
  // 懒求值会让后面的候选基于被污染的状态（甚至已关闭的作用域）生成。
  const candidates = [...moves(goal, ctx)];
  for (const mv of candidates) {
    if (budget.nodes > budget.total) return { ok: false, reason: 'budget' };
    env.stats.tries++;
    const snapshot = snapshotEnv(env);
    if (globalThis.__SOLVER_DEBUG) console.log('  '.repeat(Math.max(0, 5 - depth)) + '  尝试 ' + mv.rule + (mv.subs && mv.subs.length ? ' → 子目标 ' + mv.subs.map((s) => P(s.f || s)).join(' , ') : ''));
    const res = tryMove(env, mv, goal, rest, depth, budget);
    if (res.ok) return res;
    if (globalThis.__SOLVER_DEBUG) console.log('  '.repeat(Math.max(0, 5 - depth)) + '    ✗ ' + (res.reason || ''));
    restoreEnv(env, snapshot);
  }
  return { ok: false, reason: 'no-move' };
}

function tryMove(env, mv, goal, rest, depth, budget) {
  const ids = (mv.ids || []).slice();
  closeTrivially(env);   // 每次尝试前把“一步可得”的结论补上（事实集未变时会立即返回）

  /* A. 直接闭合：一步落下 */
  if (mv.kind === 'close' && (!mv.subs || mv.subs.length === 0)) {
    const step = buildStep(goal, mv, ids);
    const id = commit(env, step);
    if (!id) return { ok: false };
    // 关键校验：这一招必须真的得到当前目标，否则不算成功
    // 注意用 alphaEq（fkey 是树字符串、termKey 是哈希，两者不可直接比较）
    const got = factOf(env, id);
    if (globalThis.__SOLVER_DEBUG) console.log('  '.repeat(Math.max(0, 5 - depth)) + '    [close] ' + mv.rule + ' 目标=' + P(goal) + ' 得到=' + (got ? P(got.f) : 'null') + ' 相等=' + (got ? alphaEq(got.f, goal) : '-'));
    if (!got || !alphaEq(got.f, goal)) return { ok: false };
    const r = prove(env, rest, depth - 1, budget);
    if (!r.ok) return r;
    return { ok: true, emitted: r.emitted || id, steps: [{ step }, ...r.steps] };
  }

  /* B0. 代数化简链：先造一条“成立的自反等式”，再化简成目标写法 */
  if (mv.rule === 'ringChain') {
    const f = mv.formula;
    const s1 = { rule: 'eqRefl', ids: [], term: f.a };
    const id1 = commit(env, s1);
    if (!id1) return { ok: false };
    const s2 = { rule: 'ring', ids: [id1] };
    const id2 = commit(env, s2);
    if (!id2) return { ok: false };
    const got = factOf(env, id2);
    if (!got || !alphaEq(got.f, goal)) return { ok: false };
    const r = prove(env, rest, depth - 1, budget);
    if (!r.ok) return r;
    return { ok: true, emitted: r.emitted || id2, steps: [{ step: s1 }, { step: s2 }, ...r.steps] };
  }

  /* B0.51 分情况（目标本身是析取）：取排中律，两支各推一次目标 */
  if (mv.rule === 'caseSplitGoal') {
    const em = { rule: 'excludedMiddle', ids: [], formula: mv.em };
    const emId = commit(env, em);
    if (!emId) return { ok: false };
    // 支 1：假设 t，证目标
    const s1 = 'H' + (env.uid++);
    const a1 = commit(env, { rule: 'assume', assume: mv.branch, scope: s1 });
    if (!a1) return { ok: false };
    env.scope.push({ id: s1, f: mv.branch });
    const p1 = prove(env, [goal], depth - 1, budget);
    if (!p1.ok) { closeScope(env, s1); return p1; }
    env.scope.pop();
    commit(env, { rule: 'impI', ids: [p1.emitted], scope: s1 });
    closeScope(env, s1);
    // 支 2：假设 ¬t，证目标
    const s2 = 'H' + (env.uid++);
    const negBranch = not(mv.branch);
    const a2 = commit(env, { rule: 'assume', assume: negBranch, scope: s2 });
    if (!a2) return { ok: false };
    env.scope.push({ id: s2, f: negBranch });
    const p2 = prove(env, [goal], depth - 1, budget);
    if (!p2.ok) { closeScope(env, s2); return p2; }
    env.scope.pop();
    commit(env, { rule: 'impI', ids: [p2.emitted], scope: s2 });
    closeScope(env, s2);
    const step = { rule: 'orE', ids: [emId, p1.emitted, p2.emitted] };
    const id = commit(env, step);
    if (!id) return { ok: false };
    const got = factOf(env, id);
    if (!got || !alphaEq(got.f, goal)) return { ok: false };
    const r = prove(env, rest, depth - 1, budget);
    if (!r.ok) return r;
    return { ok: true, emitted: r.emitted || id, steps: [{ step: em }, ...p1.steps, ...p2.steps, { step }, ...r.steps] };
  }

  /* B0.52 分情况：对已有析取的两支分别推出目标 */
  if (mv.rule === 'orEBranch') {
    const major = mv.ids[0];
    const branch = mv.branch;
    const left = prove(env, [branch], depth - 1, budget);
    if (!left.ok) return left;
    const right = prove(env, [branch], depth - 1, budget);
    if (!right.ok) return right;
    // 两支的结论都是目标本身：直接用 ∨E 合起来
    const step = { rule: 'orE', ids: [major, left.emitted, right.emitted] };
    const id = commit(env, step);
    if (!id) return { ok: false };
    const got = factOf(env, id);
    if (!got || !alphaEq(got.f, goal)) return { ok: false };
    const r = prove(env, rest, depth - 1, budget);
    if (!r.ok) return r;
    return { ok: true, emitted: r.emitted || id, steps: [...left.steps, ...right.steps, { step }, ...r.steps] };
  }

  /* B0.55 两边同乘/同加某个项：先证中间式，再施加运算，最后用化简接上目标 */
  if (mv.rule === 'eqOpTerm') {
    const sub = prove(env, mv.subs, depth - 1, budget);
    if (!sub.ok) return sub;
    const mid = { rule: 'eqOpTerm', op: mv.op, ids: [sub.emitted] };
    const id = commit(env, mid);
    if (!id) return { ok: false };
    const got = factOf(env, id);
    if (!got) return { ok: false };
    // 结果直接用 ring 化简（域公理保证合法）
    const norm = { rule: 'ring', ids: [id] };
    const id2 = commit(env, norm);
    const got2 = id2 ? factOf(env, id2) : null;
    const useId = (got2 && alphaEq(got2.f, goal)) ? id2 : (alphaEq(got.f, goal) ? id : null);
    if (!useId) return { ok: false };
    const r = prove(env, rest, depth - 1, budget);
    if (!r.ok) return r;
    const steps = [...sub.steps, { step: mid }];
    if (useId === id2) steps.push({ step: norm });
    return { ok: true, emitted: r.emitted || useId, steps: [...steps, ...r.steps] };
  }

  /* B0.5 反向传递：先证中间等式，再把它与已有等式传递起来 */
  if (mv.rule === 'eqTransBack' || mv.rule === 'eqTransBack2') {
    const sub = prove(env, mv.subs, depth - 1, budget);
    if (!sub.ok) return sub;
    // eqTrans 对两个等式做传递；哪一个在前由中间项决定
    const idsOrder = [mv.ids[0], sub.emitted];
    let step = { rule: 'eqTrans', ids: idsOrder };
    let id = commit(env, step);
    let got = id ? factOf(env, id) : null;
    if (!got || !alphaEq(got.f, goal)) {
      step = { rule: 'eqTrans', ids: [sub.emitted, mv.ids[0]] };
      id = commit(env, step);
      got = id ? factOf(env, id) : null;
    }
    if (!got || !alphaEq(got.f, goal)) return { ok: false };
    const r = prove(env, rest, depth - 1, budget);
    if (!r.ok) return r;
    return { ok: true, emitted: r.emitted || id, steps: [...sub.steps, { step }, ...r.steps] };
  }

  /* B0.6 解一元一次方程：证明“起点等式”，再依次施加运算序列 */
  if (mv.rule === 'solveLinear') {
    const sub = prove(env, mv.subs, depth - 1, budget);
    if (!sub.ok) return sub;
    const steps = [...sub.steps];
    let cur = sub.emitted;
    for (const op of mv.ops) {
      const step = { rule: 'eqOp', ids: [cur], op: { name: op.name, n: op.n } };
      const id = commit(env, step);
      if (!id) return { ok: false };
      steps.push({ step });
      cur = id;
    }
    const got = factOf(env, cur);
    if (!got || !alphaEq(got.f, goal)) return { ok: false };
    const r = prove(env, rest, depth - 1, budget);
    if (!r.ok) return r;
    return { ok: true, emitted: r.emitted || cur, steps: [...steps, ...r.steps] };
  }

  /* B0.7 全称蕴含反推：实例化 ∀x. P(x) → Q(x)，再证前提 P(t) 后 →E 得到目标 */
  if (mv.rule === 'allImpBack') {
    let cur = ids[0];
    const steps = [];
    for (const t of mv.terms) {
      const s = { rule: 'allE', ids: [cur], term: t };
      const id = commit(env, s);
      if (!id) return { ok: false };
      steps.push({ step: s });
      cur = id;
    }
    const inst = factOf(env, cur);
    if (!inst || inst.f.k !== 'imp') return { ok: false };
    const subGoal = inst.f.a;
    const sub = prove(env, [subGoal], depth - 1, budget);
    if (!sub.ok) return sub;
    const step = { rule: 'impE', ids: [cur, sub.emitted] };
    const id = commit(env, step);
    if (!id) return { ok: false };
    const got = factOf(env, id);
    if (!got || !alphaEq(got.f, goal)) return { ok: false };
    const r = prove(env, rest, depth - 1, budget);
    if (!r.ok) return r;
    return { ok: true, emitted: r.emitted || id, steps: [...steps, ...sub.steps, { step }, ...r.steps] };
  }

  /* B1. 反向代换：先造出“替换前”的式子，再用等式替换成目标 */
  if (mv.rule === 'eqRewriteBack') {
    const sub = prove(env, mv.subs, depth - 1, budget);
    if (!sub.ok) return sub;
    const step = { rule: 'eqRewrite', ids: [mv.ids[0], sub.emitted] };
    if (mv.pick) step.pick = mv.pick;
    const id = commit(env, step);
    if (!id) return { ok: false };
    const got = factOf(env, id);
    if (!got || !alphaEq(got.f, goal)) return { ok: false };
    const r = prove(env, rest, depth - 1, budget);
    if (!r.ok) return r;
    return { ok: true, emitted: r.emitted || id, steps: [...sub.steps, { step }, ...r.steps] };
  }

  /* B. 全称实例化链：展开成连续的 allE */
  if (mv.rule === 'lemmaChain') {
    let cur = ids[0];
    const steps = [];
    for (const t of mv.terms) {
      const st2 = { rule: 'allE', ids: [cur], term: t };
      const id = commit(env, st2);
      if (!id) return { ok: false };
      steps.push({ step: st2 });
      cur = id;
    }
    // 与闭合招法同样的要求：实例化出来的式子必须真的就是当前目标，否则这一招不算成功
    const inst = factOf(env, cur);
    if (!inst || !alphaEq(inst.f, goal)) return { ok: false };
    const emit = emitFact(env, inst.f, steps.length ? steps[0].step.rule : 'lemmaChain');
    const r = prove(env, rest, depth - 1, budget);
    if (!r.ok) return r;
    return { ok: true, emitted: r.emitted || emit, steps: [...steps, ...r.steps] };
  }

  /* C. 引入型：开假设 → 证子目标 → 合上 */
  if (mv.scope) {
    const aF = mv.rule === 'raa' ? not(goal) : goal.a;
    // 假设 id 用与证明状态机一致的 H 前缀；用 env.uid 而不是可回滚的 assumeCount
    const scopeId = 'H' + (env.uid++);
    const aId = commit(env, { rule: 'assume', assume: aF, scope: scopeId });
    if (!aId) return { ok: false };
    env.scope.push({ id: scopeId, f: aF });
    const scopeDerivBase = env.derivations.length;
    const scopeKey = env.scope.map((s) => s.id).join('|');
    const sub = prove(env, mv.subs, depth - 1, budget);
    if (!sub.ok) { closeScope(env, scopeId); return sub; }
    const inner = sub.emitted || aId;
    // 合上子证明的规则只需要“子证明的结论”这一个前提；假设 id 由内核按作用域自行匹配
    const step = buildStep(goal, mv, [inner].concat(ids));
    step.scope = scopeId;
    const id = commit(env, step);
    closeScope(env, scopeId);
    if (!id) return { ok: false };
    const common = prove(env, rest, depth - 1, budget);
    if (!common.ok) return common;
    return {
      ok: true, emitted: common.emitted || id,
      steps: [
        { step: { rule: 'assume', assume: aF, scope: scopeId } },
        ...derivationsIn(env, scopeKey, scopeDerivBase),
        ...sub.steps, { step }, ...common.steps,
      ],
    };
  }

  /* D. 复合招法（∧I / ∨E / ↔I / →E / =Trans …）：先证子目标，再用它们合成 */
  if (mv.subs && mv.subs.length) {
    // 有主前提的招法（→E、=Sub…）：主前提直接进前提表，子目标另证
    const subIds = [];
    const trail = [];
    const needSubs = RULES[mv.rule] && RULES[mv.rule].arity !== null
      ? Math.max(0, RULES[mv.rule].arity - ids.length)
      : mv.subs.length;
    for (const t of mv.subs.slice(0, needSubs)) {
      const target = t && t.k ? t : t.f;
      const derivBase = env.derivations.length;   // 失败的尝试会留下垃圾推导，这里只保留本子目标证成期间的
      const scopeKey = env.scope.map((s) => s.id).join('|');
      const sub = prove(env, [target], depth - 1, budget);
      if (!sub.ok) { env.derivations.length = derivBase; return sub; }
      trail.push(...derivationsIn(env, scopeKey, derivBase));
      trail.push(...sub.steps);
      if (sub.emitted) subIds.push(sub.emitted);
    }
    const useIds = ids.concat(subIds);
    const step = buildStep(goal, mv, useIds);   // 忘记这一行会导致 TDZ 崩溃
    const id = commit(env, step);
    if (!id) return { ok: false };
    const r = prove(env, rest, depth - 1, budget);
    if (!r.ok) return r;
    return { ok: true, emitted: r.emitted || id, steps: [...trail, { step }, ...r.steps] };
  }

  /* E. 兜底：没有子目标也不是 close */
  const step = buildStep(goal, mv, ids);
  const id = commit(env, step);
  if (!id) return { ok: false };
  const r = prove(env, rest, depth - 1, budget);
  if (!r.ok) return r;
  return { ok: true, emitted: r.emitted || id, steps: [{ step }, ...r.steps] };
}

/* 把计划在干净状态上重放一遍，确认达到目标（解算器的最后一道保险） */
export function verifyPlan(compiled, derivations, steps) {
  const st = freshState(compiled);
  const all = (derivations || []).map((d) => ({ step: d })).concat(steps || []);
  for (const s of all) {
    try { applyStep(st, s.step); } catch (e) { return false; }
  }
  return !!matchedFact(st);
}

/* 公理的体与目标是否共享函数/谓词符号：用来决定值不值得实例化 */
function sharesSymbolWithGoal(axiomBody, goal) {
  const sym = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.k === 'c') sym.add(node.name);
    if (node.k === 'atom') sym.add('@' + node.name);
    if (node.k === 'eq') sym.add('=');
    if (node.args) node.args.forEach(walk);
    if (node.a) walk(node.a);
    if (node.b) walk(node.b);
    if (node.body) walk(node.body);
  };
  walk(goal);
  let hit = false;
  const check = (node) => {
    if (hit || !node || typeof node !== 'object') return;
    if (node.k === 'c' && sym.has(node.name)) hit = true;
    if (node.k === 'atom' && sym.has('@' + node.name)) hit = true;
    if (node.k === 'eq' && sym.has('=')) hit = true;
    if (node.args) node.args.forEach(check);
    if (node.a) check(node.a);
    if (node.b) check(node.b);
    if (node.body) check(node.body);
  };
  check(axiomBody);
  return hit;
}

/* 前向闭包：做一轮 →E / ∧E / ∀E(已有项) / ¬E，把“一步可得”的结论补进事实表。
   只做不产生分支的规则。轮数必须克制：第二轮会把第一轮实例化出来的上百条也拿去实例化，规模爆炸。 */
export function closeTrivially(env, maxRounds = 1) {
  const st = env.state;
  // 事实集没变化就不用再跑一遍（闭包的最大开销是反复实例化公理）
  if (env.lastCloseSize === st.facts.length) return 0;
  env.lastCloseSize = st.facts.length;
  // 事实键集合：避免对每条新事实都做一次线性扫描（这是之前的性能瓶颈）
  if (!env.factKeys) {
    env.factKeys = new Set();
    for (const f of st.facts) env.factKeys.add(fkey(f.f));
  }
  const has = (f) => env.factKeys.has(fkey(f));
  if (!env.termPool) env.termPool = termUniverse([st.goal], []).slice(0, 4);
  if (!env.instSeen) { env.instSeen = new Set(); env.instSeenTop = new Set(); }
  const atTop = env.scope.length === 0;
  const instKey = (id, t) => id + '|' + termKey(t);
  let added = 0;
  for (let round = 0; round < maxRounds; round++) {
    let changed = false;
    const snapshot = st.facts.slice();
    for (const f of snapshot) {
      const rules = [];
      if (f.f.k === 'imp') rules.push({ rule: 'impE', needs: [f.f.a] });
      if (f.f.k === 'and') rules.push({ rule: 'andE', pick: '左' }, { rule: 'andE', pick: '右' });
      if (f.f.k === 'iff') rules.push({ rule: 'iffE', pick: '→' }, { rule: 'iffE', pick: '←' });
      for (const r of rules) {
        try {
          let ids = [f.id];
          if (r.needs) {
            const other = st.facts.find((g) => g.id !== f.id && fkey(g.f) === fkey(r.needs[0]));
            if (!other) continue;
            ids = [f.id, other.id];
          }
          const step = { rule: r.rule, ids };
          if (r.pick) step.pick = r.pick;
          const res = runRule(st, step);
          if (has(res.f)) continue;
          const fact = makeFact(st, res, ids);
          fact.solver = true;
          env.factKeys.add(fkey(fact.f));
          recordDerivation(env, step);
          added++;
          changed = true;
        } catch (e) { /* 该情形不成立，跳过 */ }
      }
      // ∀E：用目标里出现的项实例化。项池要克制（放宽到 24 个会让闭包规模爆炸、单关慢到分钟级）
      if (f.f.k === 'all') {
        for (const t of env.termPool) {
          if (atTop && env.instSeenTop.has(instKey(f.id, t))) continue;   // 顶层实例化结果可复用
          if (atTop) env.instSeenTop.add(instKey(f.id, t));
          try {
            const allStep = { rule: 'allE', ids: [f.id], term: t };
            const res = runRule(st, allStep);
            if (has(res.f)) continue;
            const fact = makeFact(st, res, [f.id]);
            fact.solver = true;
            env.factKeys.add(fkey(fact.f));
            recordDerivation(env, allStep);
            added++;
            changed = true;
          } catch (e) { /* 跳过 */ }
        }
      }
      // ¬E：同时有 A 与 ¬A 就得到 ⊥
      if (f.f.k === 'not') {
        const other = st.facts.find((g) => g.id !== f.id && fkey(g.f) === fkey(f.f.a));
        if (other) {
          try {
            const negStep = { rule: 'negE', ids: [f.id, other.id] };
            const res = runRule(st, negStep);
            if (!has(res.f)) {
              const fact = makeFact(st, res, [f.id, other.id]);
              fact.solver = true;
              env.factKeys.add(fkey(fact.f));
              recordDerivation(env, negStep);
              added++;
              changed = true;
            }
          } catch (e) { /* 跳过 */ }
        }
      }
    }
    if (!changed) break;
  }
  return added;
}

/* 记一条闭包推导：顶层的一条会在验证时先重放，子证明内的会内联进 steps */
function recordDerivation(env, step) {
  env.derivations.push({ scope: env.scope.map((s) => s.id).join('|'), step });
  if (env.scope.length === 0) env.topDerivations.push(step);
}

/* 取出某作用域下的推导步骤 */
function derivationsIn(env, scopeKey, from) {
  return env.derivations.slice(from)
    .filter((d) => d.scope === scopeKey)
    .map((d) => ({ step: d.step }));
}

/* 把一条已证结论登记成事实（供后续步骤当前前提用），返回它的 id。
   id 用 '<首条规则>_<序号>'：既唯一可读，也能直接摘进关卡脚本当引用。 */
function emitFact(env, f, tag) {
  const base = (tag && String(tag).replace(/[^A-Za-z0-9]/g, '')) || 'd';
  let n = 1;
  let id = base + '_' + n;
  while (env.state.facts.some((x) => x.id === id)) id = base + '_' + (++n);
  env.state.nextId++;
  const fact = { id, f, rule: 'derived', from: [], scope: env.scope.map((s) => s.id).join('|') || null };
  env.uid = env.state.nextId;
  env.state.facts.push(fact);
  env.facts.push(fact);
  return fact.id;
}

/* 组装一步：只填内核需要的字段 */
function buildStep(goal, mv, ids) {
  const step = { rule: mv.rule, ids: ids || [] };
  if (mv.term) step.term = mv.term;
  if (mv.terms && mv.terms.length === 1 && mv.rule === 'eqRefl') step.term = mv.terms[0];
  if (mv.pick) step.pick = mv.pick;
  if (mv.formula) step.formula = mv.formula;
  if (mv.op) step.op = mv.op;
  if (step.rule === 'ring' || step.rule === 'arith') {
    if (!step.ids.length && !step.formula) step.formula = goal;
    else if (!step.ids.length && step.formula) { /* 已带 */ }
  }
  return step;
}

/* 在状态里落一步，成功返回事实 id */
function commit(env, step) {
  const st = env.state;
  try {
    if (step.rule === 'assume') {
      const f = step.assume;
      const id = step.scope;
      st.assumptions[id] = f;
      const fact = { id, f, rule: 'assume', from: [], scope: id };
      st.facts.push(fact);
      st.scopeStack.push(id);
      env.facts.push(fact);
      return id;
    }
    if (step.rule === 'lemmaChain') return null;   // 展开成多条 allE，不直接落
    // 用内核检查这一步
    const res = runRule(st, step);   // step 里的 keepLeft 会被 runRule 读取
    const fact = makeFact(st, res, step.ids || []);
    env.facts.push(fact);
    return fact.id;
  } catch (e) {
    if (globalThis.__SOLVER_DEBUG) console.log('      [commit 抛错] ' + (e && e.message));
    return null;
  }
}

function factOf(env, id) {
  return env.state.facts.find((f) => f.id === id) || env.facts.find((f) => f.id === id);
}
function closeScope(env, scopeId) {
  const st = env.state;
  const open = new Set();
  for (const f of st.facts) {
    if (!f.scope) continue;
    for (const s of String(f.scope).split('|')) if (s) open.add(s);
  }
  delete st.assumptions[scopeId];
  st.scopeStack = st.scopeStack.filter((id) => id !== scopeId);
  st.facts = st.facts.filter((f) => !f.scope || String(f.scope).split('|').every((id) => open.has(id) || st.assumptions[id] !== undefined));
  env.facts = env.facts.filter((f) => st.facts.indexOf(f) >= 0);
  const i = env.scope.map((s) => s.id).lastIndexOf(scopeId);
  if (i >= 0) env.scope.splice(i, 1);
}
function snapshotEnv(env) {
  return {
    derivLen: env.derivations.length,      // 闭包推导也要能回滚，否则失败尝试的垃圾会混进最终计划
    topDerivLen: env.topDerivations.length,
    factLen: env.state.facts.length,
    factsLen: env.facts.length,
    scopeLen: env.scope.length,
    nextId: env.state.nextId,
    assumeCount: env.state.assumeCount,
    assumptions: Object.assign({}, env.state.assumptions),
    scopeStack: env.state.scopeStack.slice(),
    sysN: env.sys.n,
  };
}
function restoreEnv(env, snap) {
  const st = env.state;
  env.derivations.length = snap.derivLen;
  env.topDerivations.length = snap.topDerivLen;
  st.facts.length = snap.factLen;
  env.facts.length = snap.factsLen;
  env.scope.length = snap.scopeLen;
  st.nextId = snap.nextId;
  st.assumeCount = snap.assumeCount;
  st.assumptions = snap.assumptions;
  st.scopeStack = snap.scopeStack;
  env.sys.n = snap.sysN;
}
