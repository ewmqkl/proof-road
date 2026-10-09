// core/tactics.js —— 反向搜索的“招法”：从目标倒推，返回候选的分解方式
// 每个招法给出：要证的子目标列表、期间引入的假设、把子证明拼成一步的方式。
import {
  P, fstr, alphaEq, fkey, termKey, TOP, BOT,
  atom, eq, not, and, or, imp, iff, all, ex, c0, v, lit, instAll, openAt,
} from './logic.js';
import { polyOfTerm, polyToTerm, evalReduce } from './rules.js';

const intEq = (a, b) => a.n === b.n && a.d === b.d;
const SYS_PREFIX = '##solver';

/* 具体数值求值（只对无变量的式子） */
export function evalNum(t) {
  if (t.k === 'n') return t.n;
  if (t.k !== 'c') return null;
  const a = t.args.map(evalNum);
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
const RELS = { lt: '<', le: '≤', gt: '>', ge: '≥' };
function relHolds(name, a, b) {
  return name === 'lt' ? a < b : name === 'le' ? a <= b : name === 'gt' ? a > b : a >= b;
}

/* 从子目标里收集可用的项（用于 ∀E 的实例化） */
export function termUniverse(goals, extra = []) {
  const seen = new Map();
  const add = (t) => { const k = termKey(t); if (!seen.has(k)) seen.set(k, t); };
  // 注意：量词下面的是绑定变量（de Bruijn 索引），不能拿来当实例化项——否则会造出 x1+x2 这种垃圾
  const walkTerm = (t) => {
    if (t.k === 'v' || t.k === 'n' || t.k === 'c') add(t);
    if (t.k === 'c') t.args.forEach(walkTerm);
  };
  const walk = (f, underBinder = false) => {
    if (!f) return;
    if (f.k === 'atom') f.args.forEach(walkTerm);
    else if (f.k === 'eq') { walkTerm(f.a); walkTerm(f.b); }
    else if (f.k === 'not') walk(f.a, underBinder);
    else if (f.k === 'all' || f.k === 'ex') walk(f.body, true);
    else { if (f.a) walk(f.a, underBinder); if (f.b) walk(f.b, underBinder); }
  };
  for (const g of goals) walk(g);
  for (const t of extra) walkTerm(t);
  for (const n of ['x', 'y', 'z', 'a', 'b', 'c']) add(v(n, true));
  for (const n of [0, 1, 2]) add(lit(n));
  return [...seen.values()].slice(0, 24);
}

/**
 * 生成“从目标倒推”的候选招法。
 * ctx = { state, scope, sys: {n}, facts }  —— facts 是已推导出的事实数组（可被引用的前提）
 */
export function* moves(goal, ctx) {
  const base = { ids: [], terms: [] };
  const available = () => ctx.state.facts.concat(ctx.facts || []);

  /* 0) 已经证过 / 就是前提或假设 */
  for (const f of available()) {
    if (alphaEq(f.f, goal)) {
      yield { rule: 'hyp', ids: [f.id], terms: [], subs: [], kind: 'close', label: '引用已有事实' };
      return;
    }
  }

  /* 1) 蕴含引入 */
  if (goal.k === 'imp') {
    const sc = ctx.scope + '|s' + (++ctx.sys.n);
    yield {
      rule: 'impI', ids: [], terms: [], scope: sc, kind: 'intro',
      subs: [{ f: goal.b, scope: sc }],
      label: '假设 ' + P(goal.a) + ' 推出 ' + P(goal.b),
      hint: '打开子证明假设 ' + P(goal.a),
    };
  }

  /* 2) 合取引入 */
  if (goal.k === 'and') {
    yield { rule: 'andI', ids: [], terms: [], kind: 'intro', subs: [{ f: goal.a }, { f: goal.b }], label: '分别证明两边' };
  }

  /* 2.1) 等价引入：两个方向分别证 */
  if (goal.k === 'iff') {
    yield {
      rule: 'iffI', kind: 'intro', ids: [],
      subs: [{ f: imp(goal.a, goal.b) }, { f: imp(goal.b, goal.a) }],
      label: '分别证明 A → B 与 B → A',
    };
  }

  /* 3) 析取引入 */
  if (goal.k === 'or') {
    yield { rule: 'orI', ids: [], terms: [], formula: goal, kind: 'intro', subs: [{ f: goal.a }], label: '证左支' };
    yield { rule: 'orI', ids: [], terms: [], formula: goal, kind: 'intro', subs: [{ f: goal.b }], label: '证右支' };
  }

  /* 4) 否定引入：¬A ← 假设 A 推出 ⊥ */
  if (goal.k === 'not') {
    const sc = ctx.scope + '|s' + (++ctx.sys.n);
    yield {
      rule: 'negI', ids: [], terms: [], scope: sc, kind: 'intro',
      subs: [{ f: BOT, scope: sc }],
      label: '假设 ' + P(goal.a) + ' 推出矛盾',
      hint: '打开子证明假设 ' + P(goal.a) + '，目标改为 ⊥',
    };
  }

  /* 5) 反证法：A ← 假设 ¬A 推出 ⊥ */
  {
    const sc = ctx.scope + '|s' + (++ctx.sys.n);
    yield {
      rule: 'raa', ids: [], terms: [], scope: sc, kind: 'intro',
      subs: [{ f: BOT, scope: sc }],
      label: '反证法：假设 ¬' + P(goal) + ' 推出矛盾',
      hint: '打开子证明假设 ' + P(not(goal)) + '，目标改为 ⊥',
    };
  }

  /* 6) 从已有全称事实/公理实例化（∀E 链） */
  for (const f of available()) {
    if (f.f.k !== 'all') continue;
    const names = [];
    let cur = f.f;
    while (cur.k === 'all') { names.push(cur.name); cur = cur.body; }
    if (names.length === 0 || names.length > 4) continue;
    // 目标导向：只用“目标或已有事实里出现过”的项来实例化。
    // 之前对全项池做笛卡尔积（最多 24 组）会迅速耗尽预算。
    const goalHasFree = (() => {
      let hit = false;
      const walkT = (t) => { if (t.k === 'v' && t.free) hit = true; if (t.k === 'c') t.args.forEach(walkT); };
      const walk = (f) => {
        if (!f || hit) return;
        if (f.k === 'eq') { walkT(f.a); walkT(f.b); }
        else if (f.k === 'atom') (f.args || []).forEach(walkT);
        else if (f.k === 'not') walk(f.a);
        else if (f.k === 'all' || f.k === 'ex') walk(f.body);
        else { if (f.a) walk(f.a); if (f.b) walk(f.b); }
      };
      walk(goal);
      return hit;
    })();
    // 目标里没有自由变量时，就不该拿自由变量去实例化（否则全是“? + -?”这类无效组合）
    const universe = termUniverse([goal].concat(ctx.state.facts.map((x) => x.f)), [])
      .filter((t) => goalHasFree || !(t.k === 'v' && t.free))
      .slice(0, 8);
    const combos = nameCombos(universe, names.length, 12);
    for (const combo of combos) {
      yield { rule: 'lemmaChain', ids: [f.id], terms: combo, kind: 'lemma', label: '把 ' + (f.ax ? f.ax.id : f.id) + ' 实例化为 ' + combo.map(termKeyOf).join('、') };
    }
  }

  /* 7) 从已有蕴含事实做 →E */
  for (const f of available()) {
    if (f.f.k === 'imp') {
      yield {
        rule: 'impE', kind: 'elim', ids: [f.id], subs: [{ f: f.f.a }],
        label: '用 ' + P(f.f) + ' 反推 ' + P(f.f.a),
      };
    }
    // 全称蕴含（∀x. P(x) → Q(x)）：先把量词实例化，再用 →E 反推前提
    // 例：∀a, a ≤ 0 → |a| = -a 要证 |-3| = 3 ⟹ 只需证 -3 ≤ 0
    if (f.f.k === 'all') {
      const names = [];
      let cur = f.f;
      while (cur.k === 'all') { names.push(cur.name); cur = cur.body; }
      if (cur.k === 'imp' && names.length >= 1 && names.length <= 3) {
        const univ = termUniverse([goal].concat(ctx.state.facts.map((x) => x.f)), []).slice(0, 6);
        for (const combo of nameCombos(univ, names.length, 10)) {
          yield {
            rule: 'allImpBack', kind: 'elim', ids: [f.id], terms: combo,
            label: '把 ' + (f.ax ? f.ax.id : f.id) + ' 实例化后 →E 反推',
          };
        }
      }
    }
  }

  /* 8) 等式的自反 / 对称 / 传递 / 代换 */
  if (goal.k === 'eq') {
    if (termKey(goal.a) === termKey(goal.b)) {
      yield { rule: 'eqRefl', kind: 'close', ids: [], terms: [goal.a], label: '两边相同' };
    }
    for (const f of available()) {
      if (f.f.k !== 'eq') continue;
      // 对称能一步到位时优先（例如已有 x+y=y+x 要证 y+x=x+y）
      if (termKey(f.f.a) === termKey(goal.b) && termKey(f.f.b) === termKey(goal.a)) yield { rule: 'eqSym', kind: 'close', ids: [f.id], label: '对称过来就是它' };
      if (termKey(f.f.b) === termKey(goal.a)) yield { rule: 'eqTrans', kind: 'elim', ids: [f.id], subs: [{ f: eq(f.f.a, goal.b) }], label: '接上前半段 ' + P(f.f) };
      if (termKey(f.f.a) === termKey(goal.a)) yield { rule: 'eqTrans', kind: 'elim', ids: [f.id], subs: [{ f: eq(f.f.b, goal.b) }], label: '接上后半段 ' + P(f.f) };
      // 传递（反推）：目标形如 a = c，若已有 a = b，则只差 b = c；反过来同理
      if (termKey(f.f.a) === termKey(goal.b)) yield { rule: 'eqTransBack', kind: 'elim', ids: [f.id], subs: [{ f: eq(goal.a, f.f.b) }], label: '传递反推：先证 ' + P(eq(goal.a, f.f.b)) };
      if (termKey(f.f.b) === termKey(goal.b)) yield { rule: 'eqTransBack', kind: 'elim', ids: [f.id], subs: [{ f: eq(goal.a, f.f.a) }], label: '传递反推：先证 ' + P(eq(goal.a, f.f.a)) };
      if (termKey(f.f.a) === termKey(goal.a)) yield { rule: 'eqTransBack2', kind: 'elim', ids: [f.id], subs: [{ f: eq(f.f.b, goal.b) }], label: '传递反推：先证 ' + P(eq(f.f.b, goal.b)) };
      if (termKey(f.f.b) === termKey(goal.a)) yield { rule: 'eqTransBack2', kind: 'elim', ids: [f.id], subs: [{ f: eq(f.f.a, goal.b) }], label: '传递反推：先证 ' + P(eq(f.f.a, goal.b)) };
      // 代换（正向）：fact 里出现等式某一边，替换后正好得到目标
      const opts = rewriteBoth(f.f, goal);
      if (opts) yield { rule: 'eqRewrite', kind: 'elim', ids: [f.id], formula: goal, label: '用 ' + P(f.f) + ' 代入' };
      // 代换（反推）：目标里出现等式某一边，把它换掉就该得到某个中间式——
      // 这个中间式再用 =I 造出来即可。等式链（x=y ⊢ x+1=y+1）靠这一招。
      // 注意：eqRewrite 的 pick 是“替换等式的哪一侧”（左/右），不是 a→b 的方向
      for (const [from, to, side] of [[f.f.a, f.f.b, '左'], [f.f.b, f.f.a, '右']]) {
        for (const mid of reverseRewrite(goal, from, to)) {
          yield {
            rule: 'eqRewriteBack', kind: 'elim', ids: [f.id], formula: mid, pick: side, side,
            subs: [{ f: mid }],
            label: '反向代入 ' + P(f.f) + '（替换' + side + '侧）：先造 ' + P(mid),
          };
        }
      }
    }
    // 数值计算：规则会把两边都算成具体数字，所以直接给出那个形式
    const la = evalNum(goal.a), lb = evalNum(goal.b);
    if (la !== null && lb !== null) {
      yield { rule: 'arith', kind: 'close', ids: [], formula: eq(lit(la), lit(lb)), terms: [], label: '两边都是具体数字' };
    }
    // 代数化简：规则输出规范化形式，这里就按规范化形式给
    const pa = polyOfTerm(goal.a), pb = polyOfTerm(goal.b);
    if (pa && pb && pa.size === pb.size && [...pa].every(([k, val]) => { const w = pb.get(k); return w && intEq(w, val); })) {
      const na = polyToTerm(pa), nb = polyToTerm(pb);
      // 若目标两边写法本来就完全一致，用 =I 更直接
      if (termKey(goal.a) === termKey(goal.b)) {
        yield { rule: 'eqRefl', kind: 'close', ids: [], term: goal.a, label: '两边相同' };
      } else {
        yield { rule: 'ring', kind: 'close', ids: [], formula: eq(na, nb), terms: [], label: '两边化简后相同' };
      }
    }
    // 两边同时运算：±1/2/3 与“除以目标里的系数”都要试（解方程靠它）
    const ns = [1, 2, 3];
    for (const t of [goal.a, goal.b]) {
      const sp = splitCoeff(t);
      if (sp && Number.isInteger(sp.c) && Math.abs(sp.c) > 1 && Math.abs(sp.c) <= 12 && ns.indexOf(Math.abs(sp.c)) < 0) ns.push(Math.abs(sp.c));
    }
    for (const n of ns) {
      for (const [op, name] of [['add', '加'], ['sub', '减'], ['mul', '乘'], ['div', '除']]) {
        const na = opApply(op, goal.a, n), nb = opApply(op, goal.b, n);
        yield { rule: 'eqOp', kind: 'elim', ids: [], op: { name: op, n }, subs: [{ f: eq(na, nb) }], label: '两边同' + name + ' ' + n };
      }
    }
    yield { rule: 'eqOp', kind: 'elim', ids: [], op: { name: 'neg' }, subs: [{ f: eq(c0('neg', goal.a), c0('neg', goal.b)) }], label: '两边取负' };

    // 两边乘/加“某个项”（不只是数字）：解方程时常用 1/a、−y 这类式子
    const termPool = termUniverse([goal].concat(ctx.state.facts.map((x) => x.f)), []).slice(0, 10);
    for (const t of termPool) {
      if (t.k === 'v' || t.k === 'n' || (t.k === 'c' && t.name === 'neg')) {
        yield { rule: 'eqOpTerm', kind: 'elim', ids: [], op: { name: 'add', term: t }, subs: [{ f: eq(c0('add', goal.a, t), c0('add', goal.b, t)) }], label: '两边同加 ' + termKeyOf(t) };
        yield { rule: 'eqOpTerm', kind: 'elim', ids: [], op: { name: 'mul', term: t }, subs: [{ f: eq(c0('mul', goal.a, t), c0('mul', goal.b, t)) }], label: '两边同乘 ' + termKeyOf(t) };
      }
    }

    // 真正的一元一次方程求解：从“目标等式”反推出“该从哪个式子出发、两边做什么运算”
    for (const cand of linearSolveCandidates(goal, available())) {
      yield {
        rule: 'solveLinear', kind: 'elim', ids: [cand.factId], ops: cand.steps,
        subs: [{ f: cand.premise }],
        label: '解方程：从 ' + P(cand.premise) + ' ' + cand.opText + ' 得到目标',
      };
    }
  }

  /* 9) 具体数值关系式 */
  if (goal.k === 'atom' && RELS[goal.name]) {
    const a = evalNum(goal.args[0]), b = evalNum(goal.args[1]);
    if (a !== null && b !== null && relHolds(goal.name, a, b)) {
      yield { rule: 'arith', kind: 'close', ids: [], formula: goal, terms: [], label: '具体数值比较' };
    }
  }

  /* 8.6) ∧E：从合取取一支作为中间结论（可能是子目标需要的那一支） */
  for (const f of available()) {
    if (f.f.k !== 'and') continue;
    yield { rule: 'andE', kind: 'emit', ids: [f.id], pick: '左', emit: f.f.a, label: '取 ' + P(f.f) + ' 的左支备用' };
    yield { rule: 'andE', kind: 'emit', ids: [f.id], pick: '右', emit: f.f.b, label: '取 ' + P(f.f) + ' 的右支备用' };
  }

  /* 8.54) 从已有公式造析取：P ⟹ P ∨ Q。分情况讨论时用它造出“正好能被或消去用”的析取 */
  for (const f of available()) {
    if (goal.k === 'or' && alphaEq(f.f, goal.a)) yield { rule: 'orI', kind: 'close', ids: [f.id], pick: '左', label: '由 ' + P(f.f) + ' 得到 ' + P(goal) + '（左支）' };
    if (goal.k === 'or' && alphaEq(f.f, goal.b)) yield { rule: 'orI', kind: 'close', ids: [f.id], pick: '右', label: '由 ' + P(f.f) + ' 得到 ' + P(goal) + '（右支）' };
  }

  /* 8.55) 排中律：分情况讨论时先造出 A ∨ ¬A */
  if (goal.k === 'or') {
    for (const t of [goal.a, goal.b]) {
      const other = alphaEq(t, goal.a) ? goal.b : goal.a;
      const negT = other.k === 'not' ? other.a : null;
      if (negT && alphaEq(t, negT)) {
        yield { rule: 'excludedMiddle', kind: 'close', ids: [], formula: goal, terms: [], label: '排中律：' + P(goal) + ' 恒成立' };
        // 分情况讨论：假设 t 与 ¬t 各推一次目标（两支都用 ∨I + 可用前提解决）
        yield {
          rule: 'caseSplitGoal', kind: 'elim', ids: [], em: goal, branch: t,
          subs: [{ f: goal }, { f: goal }],
          label: '分情况：先取排中律 ' + P(goal),
        };
      }
    }
  }

  /* 8.6b) ∨E 的预演：手上已有析取时，把两支分别推出某个中间结论备用。
     例如已有 A ↔ B，则“两支都推出 B”就能把目标化归到 B。 */
  for (const f of available()) {
    if (f.f.k !== 'or') continue;
    if (alphaEq(f.f.a, goal) || alphaEq(f.f.b, goal)) continue;   // 已经有支就是目标，交给 9.6
    yield {
      rule: 'orEBranch', kind: 'elim', ids: [f.id], branch: goal,
      subs: [{ f: goal }, { f: goal }],
      label: '对 ' + P(f.f) + ' 分情况，两支都推 ' + P(goal),
    };
  }

  /* 8.7) ∃I：目标存在式，用已有项做见证 */
  if (goal.k === 'ex') {
    for (const t of termUniverse([goal], [])) {
      yield { rule: 'exI', kind: 'close', ids: [], term: t, label: '用 ' + termKeyOf(t) + ' 作见证' };
    }
  }

  /* 9.2) 代数化简：先造成立等式再化简，得到“化简后的结论”
     例如要证 5x = 5x，就从 2x+3x = 2x+3x 化简过来；要证 x²-y² = x²-y² 就从 (x+y)(x-y) 化简过来 */
  if (goal.k === 'eq') {
    for (const cand of polyCandidates(goal)) {
      yield {
        rule: 'ringChain', kind: 'elim', ids: [], formula: cand,
        subs: [{ f: cand }],
        label: '两边化简后相同',
      };
    }
  }

  /* 9.5) ∧E：手上已有合取，取一支就是目标 */
  for (const f of available()) {
    if (f.f.k !== 'and') continue;
    if (alphaEq(f.f.a, goal)) yield { rule: 'andE', kind: 'close', ids: [f.id], pick: '左', label: '从 ' + P(f.f) + ' 取左支' };
    if (alphaEq(f.f.b, goal)) yield { rule: 'andE', kind: 'close', ids: [f.id], pick: '右', label: '从 ' + P(f.f) + ' 取右支' };
  }

  /* 9.6) ∨E：手上有析取，两支都能推出目标 */
  for (const f of available()) {
    if (f.f.k !== 'or') continue;
    yield {
      rule: 'orE', kind: 'elim', ids: [f.id], subs: [{ f: imp(f.f.a, goal) }, { f: imp(f.f.b, goal) }],
      label: '对 ' + P(f.f) + ' 分情况讨论',
      hint: '分情况讨论：分别证明两支都能推出目标',
    };
  }

  /* 10) 矛盾：手上同时有 A 与 ¬A */
  if (goal.k === 'bot' || goal.k === 'top') {
    for (const f of available()) {
      const nf = f.f.k === 'not' ? f.f.a : null;
      if (!nf) continue;
      for (const g of available()) {
        if (g.id === f.id) continue;
        if (alphaEq(g.f, nf)) yield { rule: 'negE', kind: 'close', ids: [f.id, g.id], label: '已有 ' + P(nf) + ' 与 ' + P(f.f) };
      }
    }
  }
}

/* 辅助：等式的可代换性（与内核 eqRewrite 的判定保持一致：换完要不同、变量不得被捕获） */
function rewriteBoth(f, goal) {
  if (f.k !== 'eq' || goal.k !== 'eq') return false;
  const [a, b] = [f.a, f.b];
  const cands = [substAny(goal.a, a, b), substAny(goal.b, a, b), substAny(goal.a, b, a), substAny(goal.b, b, a)];
  return cands.some((c) => c);
}
function substAny(t, from, to) {
  if (termKey(t) === termKey(from)) return true;
  if (t.k === 'c') return t.args.some((x) => substAny(x, from, to));
  return false;
}
function opApply(op, t, n) {
  const raw = op === 'neg' ? c0('neg', t) : c0(op, t, lit(n));
  return reduceLight(raw);
}
function reduceLight(t) {
  const v = evalNum(t);
  if (v !== null && Number.isInteger(v)) return lit(v);
  if (t.k === 'c') {
    const args = t.args.map(reduceLight);
    if (t.name === 'add' && args[1].k === 'n' && args[1].n === 0) return args[0];
    if (t.name === 'mul' && args[1].k === 'n' && args[1].n === 1) return args[0];
    return c0(t.name, ...args);
  }
  return t;
}
function termKeyOf(t) { return t.k === 'v' ? t.name : (t.k === 'n' ? String(t.n) : '...'); }

/* 从实例化等式里找出“另一端”：若 a 端与目标某端相同，则另一端就是 b */
function otherEnd(instEq, goal) {
  if (termKey(instEq.a) === termKey(goal.a) || termKey(instEq.a) === termKey(goal.b)) return instEq.b;
  return instEq.a;
}
function instAllTerms(f, combo) { return combo; }

/* 公式里“能算出具体值”的子项（如 |-3| = -(-3) 里的 -(-3)） */
function concreteSubterms(f) {
  const out = [];
  const seen = new Set();
  const addT = (t) => {
    const k = termKey(t);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  const walkT = (t) => {
    if (!t || typeof t !== 'object') return;
    if (t.k === 'c' && evalNum(t) !== null) addT(t);
    if (t.args) t.args.forEach(walkT);
  };
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.k === 'eq') { walkT(node.a); walkT(node.b); }
    if (node.k === 'atom') (node.args || []).forEach(walkT);
    if (node.args) node.args.forEach(walkT);
    if (node.a) walk(node.a);
    if (node.b) walk(node.b);
    if (node.body) walk(node.body);
  };
  walk(f);
  return out;
}

/* 提取常数系数：3*x → {c:3,t:x}，x → {c:1,t:x} */
function splitCoeff(t) {
  if (t.k === 'n') return { c: t.n, t: lit(1) };
  if (t.k !== 'c') return { c: 1, t };
  if (t.name === 'mul') {
    for (const [a, b] of [[t.args[0], t.args[1]], [t.args[1], t.args[0]]]) {
      if (a.k === 'n') return { c: a.n, t: b };
    }
  }
  return { c: 1, t };
}

/* 一元一次方程的求解候选：目标形如 x = c，已有 a*x + b = d
   思路：把目标某一边的变量记为 v，从前提等式里解出 v，反推“两边该做哪一步运算”。 */
export function linearSolveCandidates(goal, facts) {
  const out = [];
  // 找出目标里那个“一次变量”项：x 或 c*x 或 -x
  const findVar = (t) => {
    if (t.k === 'v') return { v: t, coef: 1, rest: lit(0) };
    if (t.k === 'c' && t.name === 'neg' && t.args[0].k === 'v') return { v: t.args[0], coef: -1, rest: lit(0) };
    if (t.k === 'c' && t.name === 'mul') {
      for (const [a, b] of [[t.args[0], t.args[1]], [t.args[1], t.args[0]]]) {
        if (a.k === 'n' && b.k === 'v') return { v: b, coef: a.n, rest: lit(0) };
      }
    }
    if (t.k === 'c' && t.name === 'add') {
      const l = findVar(t.args[0]), r = findVar(t.args[1]);
      if (l && l.rest.k === 'n' && l.rest.n === 0) return { v: l.v, coef: l.coef, rest: t.args[1] };
      if (r && r.rest.k === 'n' && r.rest.n === 0) return { v: r.v, coef: r.coef, rest: t.args[0] };
    }
    return null;
  };
  const leftVar = findVar(goal.a);
  const rightVar = leftVar ? null : findVar(goal.b);
  const target = leftVar || rightVar;
  if (!target) return out;
  const rhs = leftVar ? goal.b : goal.a;   // 目标里没有变量的那一侧（解的值）
  for (const f of facts) {
    if (f.f.k !== 'eq') continue;
    const pa = polyOfTerm(f.f.a), pb = polyOfTerm(f.f.b);
    if (!pa || !pb) continue;
    // 只看线性式：单项 x 的幂为 1，且没有其他变量的高次项
    const lin = (p) => {
      let coef = null, konst = 0, ok = true;
      for (const [k, val] of p) {
        if (k === '') { konst += val.n / val.d; continue; }
        const parts = k.split('*');
        if (parts.length !== 1) { ok = false; break; }
        const seg = parts[0].split('^');
        if (seg.length > 1 && Number(seg[1]) !== 1) { ok = false; break; }
        if (seg[0] !== target.v.name) { ok = false; break; }
        coef = val.n / val.d;
      }
      return ok ? { coef: coef === null ? 0 : coef, konst } : null;
    };
    const la = lin(pa), lb = lin(pb);
    if (!la || !lb) continue;
    // 把等式整理成 A·x + B = 0：A 是变量系数，B 是常数之差
    const A = la.coef;
    const B = la.konst - lb.konst;
    if (!Number.isFinite(A) || A === 0) continue;
    const sol = -B / A;                          // x = sol
    const rv = evalNum(rhs);
    if (rv === null || rv !== sol) continue;      // 目标右边必须是这个解
    // 决定运算：先两边减 b、再两边除以 a（按前提的常数项与系数）
    // 有变量的那一侧（la）去掉常数项、再除以系数，就得到解
    const steps = [];
    if (la.konst !== 0) steps.push({ name: 'sub', n: la.konst, text: '同减 ' + la.konst });
    if (la.coef !== 1) steps.push({ name: 'div', n: la.coef, text: '同除以 ' + la.coef });
    let cur = f.f;
    let valid = true;
    for (const s of steps) {
      cur = eq(opApplyLocal(s.name, cur.a, s.n), opApplyLocal(s.name, cur.b, s.n));
    }
    if (termKey(cur.a) !== termKey(goal.a) || termKey(cur.b) !== termKey(goal.b)) continue;
    out.push({ factId: f.id, premise: f.f, op: steps[0] ? { name: steps[0].name, n: steps[0].n } : null, steps, opText: steps.map((s) => s.text).join('、') });
  }
  return out.slice(0, 4);
}

/* 对项施加“两边同时运算”：必须与内核 EQUATION_OPS 完全一致，所以直接复用 evalReduce */
function opApplyLocal(op, t, n) {
  return op === 'neg' ? evalReduce(c0('neg', t)) : evalReduce(c0(op, t, lit(n)));
}

/* 公式里“能算出具体值”的子项（如 |-3| = -(-3) 里的 -(-3)） */
function concreteSubtermsOf(f) {
  const out = [];
  const seen = new Set();
  const walkT = (t) => {
    if (!t || typeof t !== 'object') return;
    if (t.k === 'c') {
      const k = termKey(t);
      if (!seen.has(k) && evalNum(t) !== null) { seen.add(k); out.push(t); }
    }
    if (t.args) t.args.forEach(walkT);
  };
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.k === 'atom') (node.args || []).forEach(walkT);
    if (node.k === 'eq') { walkT(node.a); walkT(node.b); }
    if (node.a) walk(node.a);
    if (node.b) walk(node.b);
    if (node.body) walk(node.body);
  };
  walk(f);
  return out;
}

/* 把公式里满足 pred 的项替换成给定值；返回 null 表示没有可替换的 */
function mapTerms(f, pick) {
  const mapT = (t) => {
    const r = pick(t);
    if (r) return r;
    if (t.k === 'c') return c0(t.name, ...t.args.map(mapT));
    return t;
  };
  if (f.k !== 'eq') return null;
  const a = mapT(f.a), b = mapT(f.b);
  if (termKey(a) === termKey(f.a) && termKey(b) === termKey(f.b)) return null;
  return eq(a, b);
}

/* 反向代换候选：把 goal 里某一处 from 换成 to，得到“替换前”的式子 */
function reverseRewrite(goal, from, to) {
  const out = [];
  const push = (f) => {
    const k = fkeyOf(f);
    if (k === fkeyOf(goal)) return;
    if (out.some((x) => fkeyOf(x) === k)) return;
    out.push(f);
  };
  const positions = (t) => {
    // 返回 [新项, 说明]：把 t 里任一处 from 换成 to 的所有结果
    const res = [];
    if (termKey(t) === termKey(from)) res.push(to);
    if (t.k === 'c') {
      t.args.forEach((arg, i) => {
        for (const alt of positions(arg)) {
          const args = t.args.slice();
          args[i] = alt;
          res.push(c0(t.name, ...args));
        }
      });
    }
    return res;
  };
  if (goal.k === 'eq') {
    for (const a of positions(goal.a)) push(eq(a, goal.b));
    for (const b of positions(goal.b)) push(eq(goal.a, b));
    for (const a of positions(goal.a)) for (const b of positions(goal.b)) push(eq(a, b));
  }
  return out.slice(0, 6);
}

/* 生成“化简后可能等于目标”的等式候选：把目标某一边的各种等价写法拿来配对。
   注意：候选两边可以相同（如 2x+3x = 2x+3x），那正是化简题的起点——
   只要这一边“还能被化简”，它就有用。 */
function polyCandidates(goal) {
  const out = [];
  const simplifiable = (t) => {
    const p = polyOfTerm(t);
    if (!p) return false;
    return termKey(polyToTerm(p)) !== termKey(t);   // 化简后确实变了
  };
  const push = (a, b) => {
    const f = eq(a, b);
    if (termKey(f.a) === termKey(f.b) && !simplifiable(f.a)) return;   // 真正的平凡自反式
    if (fkeyOf(f) === fkeyOf(goal)) return;                            // 与目标写法相同，没必要
    if (out.some((x) => fkeyOf(x) === fkeyOf(f))) return;
    out.push(f);
  };
  for (const t of SUGAR) push(t(goal.a), t(goal.b));
  // 再试“把两边某个小系数拆开/降幂”的写法：这是纸笔演算里最常见的中间形态
  for (const t of UNSUGAR) {
    for (const side of ['a', 'b']) {
      const a = side === 'a' ? t(goal.a) : goal.a;
      const b = side === 'a' ? goal.b : t(goal.b);
      if (a !== goal.a || b !== goal.b) push(a, b);
    }
  }
  return out.slice(0, 6);
}

/* 把式子写得“更啰嗦”一点：拆系数、平方写回乘法、减法写回加相反数 */
const UNSUGAR = [
  // 5*x → 2*x + 3*x
  (t) => (t.k === 'c' && t.name === 'mul' && t.args[0].k === 'n' && Math.abs(t.args[0].n) >= 2 && Math.abs(t.args[0].n) <= 9
    ? (() => { const n = t.args[0].n; return c0('add', c0('mul', lit(n - 1), t.args[1]), t.args[1]); })()
    : t),
  // x² → x * x
  (t) => (t.k === 'c' && t.name === 'sq' ? c0('mul', t.args[0], t.args[0]) : t),
  // a - b → a + (-b)
  (t) => (t.k === 'c' && t.name === 'sub' ? c0('add', t.args[0], c0('neg', t.args[1])) : t),
  // x*y → y*x（交换一次，制造需要交换律的中间形态）
  (t) => (t.k === 'c' && t.name === 'mul' && t.args[0].k !== 'n' && t.args[1].k !== 'n' ? c0('mul', t.args[1], t.args[0]) : t),
];
function fkeyOf(f) {
  // 只用于去重：借用 termKey 结构
  const t = (x) => (x.k === 'c' ? x.name + '(' + x.args.map(t).join(',') + ')' : x.k === 'v' ? x.name : x.k === 'n' ? String(x.n) : '?');
  const walk = (node) => {
    if (!node || typeof node !== 'object') return '?';
    if (node.k === 'eq') return t(node.a) + '=' + t(node.b);
    if (node.k === 'atom') return node.name + '(' + node.args.map(t).join(',') + ')';
    if (node.k === 'not') return 'not(' + walk(node.a) + ')';
    if (node.k === 'and' || node.k === 'or' || node.k === 'imp' || node.k === 'iff') return node.k + '(' + walk(node.a) + ',' + walk(node.b) + ')';
    if (node.k === 'all' || node.k === 'ex') return node.k + '(' + walk(node.body) + ')';
    return t(node);
  };
  return walk(f);
}
/* 目标某一边的“等价写法”：平方展开、平方差等常见变形（只用于生成候选，成不成立交给内核与化简判定） */
const SUGAR = [
  (t) => (t.k === 'c' && t.name === 'sq' && t.args[0].k === 'c' && t.args[0].name === 'add'
    ? c0('add', c0('add', c0('sq', t.args[0].args[0]), c0('mul', lit(2), c0('mul', t.args[0].args[0], t.args[0].args[1]))), c0('sq', t.args[0].args[1]))
    : t),
  (t) => (t.k === 'c' && t.name === 'mul' && t.args[0].k === 'c' && t.args[0].name === 'add' && t.args[1].k === 'c' && t.args[1].name === 'sub'
    ? c0('sub', c0('sq', t.args[0].args[0]), c0('sq', t.args[1].args[1]))
    : t),
];
function nameCombos(universe, n, cap) {
  const out = [];
  const rec = (acc) => {
    if (out.length >= cap) return;
    if (acc.length === n) { out.push(acc.slice()); return; }
    for (const t of universe) { acc.push(t); rec(acc); acc.pop(); if (out.length >= cap) return; }
  };
  if (n === 1) return universe.map((t) => [t]);
  rec([]);
  return out;
}
