// core/rules.js —— 自然演绎规则引擎：每一步推理都在这里校验
import {
  TOP, BOT, atom, eq, not, and, or, imp, iff, all, ex,
  alphaEq, termEq, instAll, openAt, v, c0, lit,
  symbolsIn, symbolsInTerm, fstr, termStr,
} from './logic.js';

export const isBot = (f) => f.k === 'bot';
export const allFacts = (s) => s.facts;

/* ---------- 子公式拆分 / 组合 ---------- */
export function decompose(f) {
  if (f.k === 'and' || f.k === 'or' || f.k === 'imp' || f.k === 'iff') return [f.a, f.b];
  if (f.k === 'not') return [f.a];
  if (f.k === 'all' || f.k === 'ex') return [f.body];
  return [];
}
// 注意：量词下方是绑定变量，等于替换必须整段跳过（不能靠 termEq 判断）
function rebuild(kind, parts, orig) {
  switch (kind) {
    case 'and': return and(parts[0], parts[1]);
    case 'or': return or(parts[0], parts[1]);
    case 'imp': return imp(parts[0], parts[1]);
    case 'iff': return iff(parts[0], parts[1]);
    case 'not': return not(parts[0]);
    case 'all': return all(orig.name, parts[0]);
    case 'ex': return ex(orig.name, parts[0]);
    default: return null;
  }
}

/* ---------- 等词替换：找出所有 a→b 重写后的公式 ---------- */
// vars：允许出现在替换结果中的自由变量名（作用域安全，避免量词捕获）
export function rewriteOptions(f, a, b, vars, side) {
  const out = [];
  const push = (w) => { if (w && !out.some((x) => alphaEq(x, w))) out.push(w); };
  // 情形一：f 本身是等式，其中出现 a（side 可限定只换左端或右端）
  if (f.k === 'eq') {
    const xs = side === '右' ? [f.a] : altsOrKeep(rewriteTermDeep(f.a, a, b, vars), f.a);
    const ys = side === '左' ? [f.b] : altsOrKeep(rewriteTermDeep(f.b, a, b, vars), f.b);
    for (const x of xs) for (const y of ys) {
      const w = eq(x, y);
      if (!alphaEq(w, f)) push(w);   // 与原文一模一样的“替换”不算一步
    }
  } else {
    for (const w of rewriteTermOptions(f, a, b, vars)) push(w);
  }
  // 情形二：在子公式中替换
  const kind = f.k;
  if (kind === 'all' || kind === 'ex') return out;   // 绑定变量：不进入内部替换
  const parts = decompose(f);
  for (let i = 0; i < parts.length; i++) {
    const after = rewriteOptions(parts[i], a, b, vars);
    for (const alt of after) {
      const copy = parts.slice();
      copy[i] = alt;
      push(rebuild(kind, copy, f));
    }
  }
  return out;
}
function safeVarsOf(t, allowed) {
  if (!allowed) return true;
  const s = symbolsInTerm(t, { vars: new Set(), funcs: new Set() });
  for (const n of s.vars) if (!allowed.has(n)) return false;
  return true;
}
function rewriteTermOptions(f, a, b, vars) {
  const out = [];
  switch (f.k) {
    case 'atom': {
      const args = f.args.map((t) => altsOrKeep(rewriteTermDeep(t, a, b, vars), t));
      for (const variant of cartesian(args)) out.push(atom(f.name, ...variant));
      break;
    }
    case 'eq': {
      const xs = altsOrKeep(rewriteTermDeep(f.a, a, b, vars), f.a);
      const ys = altsOrKeep(rewriteTermDeep(f.b, a, b, vars), f.b);
      for (const x of xs) for (const y of ys) out.push(eq(x, y));
      break;
    }
    default: break;
  }
  return out;
}
function rewriteTermDeep(t, a, b, vars) {
  const out = [];
  if (termEq(t, a) && safeVarsOf(b, vars)) out.push(b);
  if (t.k === 'c') {
    const args = t.args.map((x) => altsOrKeep(rewriteTermDeep(x, a, b, vars), x));
    for (const variant of cartesian(args)) out.push(c0(t.name, ...variant));
  }
  return out;
}
// 某个子项没有可替换之处时，保留原样（否则组合会全部消失）
function altsOrKeep(alts, original) { return alts.length ? alts : [original]; }
function cartesian(lists) {
  let acc = [[]];
  for (const l of lists) {
    const next = [];
    for (const prefix of acc) for (const item of l) next.push(prefix.concat([item]));
    acc = next;
  }
  return acc;
}


/* ---------- 多项式正规化：良基的“环化简”，其合法性由域公理保证 ---------- */
// 有理数
function gcdInt(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a || 1; }
function frac(n, d) {
  if (d === 0) throw new Error('除以零');
  if (d < 0) { n = -n; d = -d; }
  const g = gcdInt(n, d);
  return { n: n / g, d: d / g };
}
const fAdd = (a, b) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
const fMul = (a, b) => frac(a.n * b.n, a.d * b.d);
const fNeg = (a) => ({ n: -a.n, d: a.d });
const fZero = { n: 0, d: 1 };
const fOne = { n: 1, d: 1 };

// 多项式：Map<monomialKey, frac>，monomialKey 形如 "*x^2*y"
const MONO_ONE = '';
function monoKey(pairs) {
  return pairs.filter(([, e]) => e !== 0).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([v, e]) => (e === 1 ? v : v + '^' + e)).join('*');
}
// 合并两个“单项式键”（每个键是若干变量幂的乘积），而不是把键当成单个变量
function monoMul(a, b) {
  const count = new Map();
  for (const part of [a, b]) {
    if (!part) continue;                       // 空串 = 常数 1
    for (const seg of part.split('*')) {
      const [v, e] = seg.split('^');
      count.set(v, (count.get(v) || 0) + (e === undefined ? 1 : Number(e)));
    }
  }
  return monoKey([...count.entries()]);
}
function polyZero() { return new Map(); }
function polyConst(f) { const m = new Map(); if (f.n !== 0) m.set(MONO_ONE, f); return m; }
function polyVar(name) { const m = new Map(); m.set(monoKey([[name, 1]]), fOne); return m; }
function polyAdd(a, b) {
  const out = new Map(a);
  for (const [k, v] of b) {
    const cur = out.get(k) || fZero;
    const sum = fAdd(cur, v);
    if (sum.n === 0) out.delete(k); else out.set(k, sum);
  }
  return out;
}
function polyNeg(a) { const out = new Map(); for (const [k, v] of a) { const w = fNeg(v); if (w.n) out.set(k, w); } return out; }
function polySub(a, b) { return polyAdd(a, polyNeg(b)); }
function polyMul(a, b) {
  const out = new Map();
  for (const [ka, va] of a) for (const [kb, vb] of b) {
    const k = monoMul(ka, kb);
    const tr = fAdd(out.get(k) || fZero, fMul(va, vb));   // 同名项系数必须累加
    if (tr.n === 0) out.delete(k); else out.set(k, tr);
  }
  return out;
}
function polyPow(a, n) {
  let base = a, out = polyConst(fOne), e = n;
  while (e > 0) {
    if (e & 1) out = polyMul(out, base);
    base = polyMul(base, base);
    e >>= 1;
  }
  return out;
}

// 把项转成多项式；不支持的构造返回 null
export function polyOfTerm(t) {
  switch (t.k) {
    case 'n': return polyConst(frac(t.n, 1));
    case 'v': return polyVar(t.name);
    case 'b': return polyVar('#' + t.i);
    case 'e': return polyVar('?' + t.name);
    case 'c': {
      const { name, args } = t;
      const ps = args.map(polyOfTerm);
      if (ps.some((p) => p === null)) return null;
      switch (name) {
        case 'add': return polyAdd(ps[0], ps[1]);
        case 'sub': return polySub(ps[0], ps[1]);
        case 'mul': return polyMul(ps[0], ps[1]);
        case 'neg': return polyNeg(ps[0]);
        case 'sq': return polyMul(ps[0], ps[0]);
        case 'pow': {
          const e = args[1];
          if (e.k !== 'n' || e.n < 0 || e.n > 32) return null;
          return polyPow(ps[0], e.n);
        }
        default: return null;   // div / abs / set ...
      }
    }
    default: return null;
  }
}
export function polyStr(p) {
  if (p.size === 0) return '0';
  const terms = [...p.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => {
    const coef = v.d === 1 ? String(v.n) : v.n + '/' + v.d;
    if (k === MONO_ONE) return coef;
    return (v.n === 1 && v.d === 1) ? k : coef + '*' + k;
  });
  return terms.join(' + ');
}
// 多项式 → 项：用于把等式两边化为同一个规范形式
export function polyToTerm(p) {
  if (p.size === 0) return lit(0);
  // 按次数从高到低排列（课本写法：x² + 2x + 1），同次按单项式键
  const entries = [...p.entries()].sort((a, b) => {
    const da = monoDegree(a[0]), db = monoDegree(b[0]);
    if (da !== db) return db - da;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  const terms = entries.map(([k, f]) => monoToTerm(k, f));
  let acc = terms[0];
  for (let i = 1; i < terms.length; i++) {
    const f = entries[i][1];
    // 负系数写成减法，更接近课本写法（x² - y² 而不是 x² + -1 * y²）
    acc = negativeTerm(f) ? c0('sub', acc, terms[i]) : c0('add', acc, terms[i]);
  }
  return acc;
}
function negativeTerm(f) { return f.n < 0; }
function monoDegree(key) {
  if (key === '') return 0;
  let d = 0;
  for (const seg of key.split('*')) {
    const parts = seg.split('^');
    d += parts.length > 1 ? Number(parts[1]) : 1;
  }
  return d;
}
function monoToTerm(key, f) {
  const g = absFrac(f);
  let t = fracToTerm(g);
  if (key === '') return t;
  for (const seg of key.split('*')) {
    const parts = seg.split('^');
    const vname = parts[0];
    const exp = parts.length > 1 ? Number(parts[1]) : 1;
    let base = vname.charAt(0) === '#' ? { k: 'b', i: Number(vname.slice(1)) } : v(vname, false);
    if (exp === 2) base = c0('sq', base);
    else if (exp > 2) base = c0('pow', base, lit(exp));
    t = (t.k === 'n' && t.n === 1) ? base : c0('mul', t, base);
  }
  return t;
}
function fracToTerm(f) {
  if (f.d === 1) return lit(f.n);
  return c0('div', lit(f.n), lit(f.d));
}
function absFrac(f) { return { n: Math.abs(f.n), d: f.d }; }

export function ringEqual(a, b) {
  const pa = polyOfTerm(a), pb = polyOfTerm(b);
  if (!pa || !pb) return null;
  if (pa.size !== pb.size) return false;
  for (const [k, v] of pa) {
    const w = pb.get(k);
    if (!w || w.n !== v.n || w.d !== v.d) return false;
  }
  return true;
}
// 规则使用的判定 + 记录用到的公理
export function ringJustification(pa, pb) {
  const used = [];
  const need = (name) => { if (used.indexOf(name) < 0) used.push(name); };
  const walk = (t) => {
    if (t.k !== 'c') return;
    if (t.name === 'add' || t.name === 'sub') need('加法交换/结合');
    if (t.name === 'mul') need('乘法交换/结合/分配');
    if (t.name === 'neg') need('加法逆元');
    if (t.name === 'sq' || t.name === 'pow') need('幂的定义');
    if (t.name === 'n') need('数域运算');
    t.args.forEach(walk);
  };
  walk(pa); walk(pb);
  return used;
}

/* ---------- 规则表 ---------- */
// 每条规则：name（显示名）、hint（说明）、arity（前提个数，null=不定）、needTerm、needFormula
export const RULES = {
  hyp:       { name: '引用前提',     hint: '直接引用一个已知事实（公理、题设、已证结论）', arity: 1 },
  andI:      { name: '合取引入 ∧I',  hint: '由 A 与 B 得到 A ∧ B', arity: 2 },
  andE:      { name: '合取消去 ∧E',  hint: '由 A ∧ B 得到 A 或 B', arity: 1, picks: ['左', '右'] },
  orI:       { name: '析取引入 ∨I',  hint: '由 A 得到 A ∨ B（B 可任取）', arity: 1, needFormula: true },
  orE:       { name: '析取消去 ∨E',  hint: 'A ∨ B，A → C，B → C ⟹ C', arity: 3 },
  impE:      { name: '蕴含消去 →E',  hint: 'A → B 与 A ⟹ B（假言推理）', arity: 2 },
  impI:      { name: '蕴含引入 →I',  hint: '假设 A 推出 B，则得 A → B（先点“假设”）', arity: 1, needScope: true },
  negE:      { name: '否定消去 ¬E',  hint: 'A 与 ¬A ⟹ ⊥', arity: 2 },
  negI:      { name: '否定引入 ¬I',  hint: '假设 A 推出 ⊥，则得 ¬A（先点“假设”）', arity: 1, needScope: true },
  raa:       { name: '反证法 ⊥C',    hint: '假设 ¬A 推出 ⊥，则得 A', arity: 1, needScope: true },
  allE:      { name: '全称消去 ∀E',  hint: '∀x, P(x) ⟹ P(t)，把一个普遍公理用到具体对象上', arity: 1, needTerm: true },
  exI:       { name: '存在引入 ∃I',  hint: 'P(t) ⟹ ∃x, P(x)', arity: 1, needTerm: true },
  eqRefl:    { name: '自反 =I',      hint: 't = t', arity: 0, needTerm: true },
  eqSym:     { name: '对称 =Sym',    hint: 'a = b ⟹ b = a', arity: 1 },
  eqTrans:   { name: '传递 =Trans',  hint: 'a = b，b = c ⟹ a = c', arity: 2 },
  eqRewrite: { name: '等量代换 =Sub', hint: 'a = b 与 P(a) ⟹ P(b)', arity: 2 },
  iffI:      { name: '等价引入 ↔I',  hint: 'A → B 与 B → A ⟹ A ↔ B', arity: 2 },
  iffE:      { name: '等价消去 ↔E',  hint: 'A ↔ B ⟹ A → B 或 B → A', arity: 1, picks: ['→', '←'] },
  ring:      { name: '代数化简 Ring',  hint: '由域公理推出的等式化简：两边化成同一个多项式即成立', arity: 1 },
  arith:     { name: '数值计算',      hint: '两边都是具体数字时直接算出相等/不等关系', arity: 1 },
  eqOp:      { name: '两边同时运算',  hint: '等式两边同加/同减/同乘/同除/同取负/同平方', arity: 1, needOp: true },
  eqOpTerm:  { name: '两边同加/乘一个式子', hint: '两边同加或同乘同一个项（不只是数字），解方程常用', arity: 1, needOp: true },
  excludedMiddle: { name: '排中律', hint: 'A ∨ ¬A 恒成立，可用于分情况讨论', arity: 0 },
};
export const RULE_ORDER = ['hyp', 'impE', 'impI', 'andI', 'andE', 'orI', 'orE', 'negE', 'negI', 'raa', 'excludedMiddle', 'allE', 'exI', 'eqRefl', 'eqSym', 'eqTrans', 'eqRewrite', 'eqOp', 'iffI', 'iffE', 'ring', 'arith'];

/* 具体数字求值（仅纯数字表达式，健全） */
export function evalConcrete(t) {
  const r = (x) => {
    if (x.k === 'n') return x.n;
    if (x.k !== 'c') return null;
    const a = x.args.map(r);
    if (a.some((y) => y === null)) return null;
    switch (x.name) {
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
  };
  return r(t);
}

/* 具体数字化简：能算的部分算出来（仍保留符号部分），例如 x + 1 - 1 → x、5 - 1 → 4 */
export function evalReduce(t) {
  const r = (x) => {
    if (x.k === 'n') return lit(x.n);
    if (x.k !== 'c') return x;
    const args = x.args.map(r);
    const v = evalConcrete({ k: 'c', name: x.name, args });
    if (v !== null && Number.isInteger(v) && Math.abs(v) <= 1e9) return lit(v);
    switch (x.name) {
      case 'add':
        if (args[1].k === 'n' && args[1].n === 0) return args[0];
        if (args[0].k === 'n' && args[0].n === 0) return args[1];
        break;
      case 'sub': {
        if (args[1].k === 'n' && args[1].n === 0) return args[0];
        // 线性抵消：(t + c) - c → t，(c + t) - c → t，(t - c) + c → t
        const t = flattenAdd(args[0]);
        const hit = t.findIndex((x) => termEq(x, args[1]));
        if (hit >= 0) {
          const rest = t.filter((_, i) => i !== hit);
          if (rest.length === 0) return lit(0);
          return rest.reduce((a, b) => c0('add', a, b));
        }
        break;
      }
      case 'add': {
        // (t + c) + (-c) → t
        if (args[1].k === 'c' && args[1].name === 'neg') {
          const t = flattenAdd(args[0]);
          const hit = t.findIndex((x) => termEq(x, args[1].args[0]));
          if (hit >= 0) {
            const rest = t.filter((_, i) => i !== hit);
            if (rest.length === 0) return lit(0);
            return rest.reduce((a, b) => c0('add', a, b));
          }
        }
        break;
      }
      case 'mul':
        if (args[1].k === 'n' && args[1].n === 1) return args[0];
        if (args[0].k === 'n' && args[0].n === 1) return args[1];
        if ((args[1].k === 'n' && args[1].n === 0) || (args[0].k === 'n' && args[0].n === 0)) return lit(0);
        break;
      case 'div': {
        if (args[1].k === 'n' && args[1].n === 1) return args[0];
        if (args[1].k === 'n') {
          const n = args[1].n;
          // 先把分子里的常数因子提出来约分：(c*t)/c → t，(c*t)/d → (c/d)*t
          const split = splitCoefficient(args[0]);
          if (split && split.c % n === 0) {
            const q = split.c / n;
            return q === 1 ? split.t : c0('mul', lit(q), split.t);
          }
          if (split && n % split.c === 0) {
            // (c*t)/d → t * (c/d)，保留分数系数避免引入除法
            const num = split.c, den = n;
            const g = gcdInt(num, den);
            const p = num / g, q2 = den / g;
            const frac = c0('div', lit(p), lit(q2));
            return c0('mul', frac, split.t);
          }
          const f = factorOut(args[0], n);
          if (f !== null) return f;
          if (args[0].k === 'n' && args[0].n % n === 0) return lit(args[0].n / n);
        }
        break;
      }
      case 'neg': if (args[0].k === 'n') return lit(-args[0].n); break;
      default: break;
    }
    return c0(x.name, ...args);
  };
  return r(t);
}

// 提取“常数系数 × 其余部分”：3*x → {c:3, t:x}，x → {c:1, t:x}，2*(x+1) → {c:2, t:x+1}
function splitCoefficient(t) {
  if (t.k === 'n') return { c: t.n, t: lit(1) };
  if (t.k !== 'c') return { c: 1, t };
  if (t.name === 'mul') {
    for (const [a, b] of [[t.args[0], t.args[1]], [t.args[1], t.args[0]]]) {
      if (a.k === 'n') return { c: a.n, t: b };
    }
  }
  if (t.name === 'neg') {
    const inner = splitCoefficient(t.args[0]);
    return { c: -inner.c, t: inner.t };
  }
  if (t.name === 'div' && t.args[1].k === 'n' && t.args[0].k === 'n') {
    return { c: t.args[0].n / t.args[1].n, t: lit(1) };
  }
  return { c: 1, t };
}

// 把 add 链摊平成因子列表
function flattenAdd(t) {
  if (t.k === 'c' && t.name === 'add') return flattenAdd(t.args[0]).concat(flattenAdd(t.args[1]));
  return [t];
}
// 若能提出因子 n，返回 (t / n)；否则返回 null
function factorOut(t, n) {
  if (t.k === 'c' && t.name === 'mul') {
    for (const [a, b] of [[t.args[0], t.args[1]], [t.args[1], t.args[0]]]) {
      if (a.k === 'n' && a.n % n === 0) {
        const q = a.n / n;
        return q === 1 ? b : c0('mul', lit(q), b);
      }
    }
  }
  return null;
}

/* 对等式两边施加同一运算：f(a) = f(b)。运算必须是可判定的具体函数或“化简”。 */
export const EQUATION_OPS = {
  add: (t, n) => evalReduce(c0('add', t, lit(n))),
  sub: (t, n) => evalReduce(c0('sub', t, lit(n))),
  mul: (t, n) => evalReduce(c0('mul', t, lit(n))),
  div: (t, n) => evalReduce(c0('div', t, lit(n))),
  neg: (t) => evalReduce(c0('neg', t)),
  sq: (t) => c0('sq', t),
};

export class RuleError extends Error {}

/* ---------- 主检查入口 ----------
 * state: { facts: Fact[], scope: string|null, nextId: number, freshCount: number }
 * Fact:  { id, f, rule, from: string[], terms?: Term[], scope: string|null, name?: string }
 * req:   { rule, ids: string[], term?: Term, formula?: Formula, pick?: '左'|'右'|'→'|'←' }
 */
export function runRule(state, req) {
  const spec = RULES[req.rule];
  if (!spec) throw new RuleError('未知规则: ' + req.rule);
  const byId = new Map(state.facts.map((f) => [f.id, f]));
  const premises = (req.ids || []).map((id) => {
    const f = byId.get(id);
    if (!f) throw new RuleError('找不到前提 ' + id);
    return f;
  });
  if (spec.arity !== null && premises.length !== spec.arity) {
    throw new RuleError(spec.name + ' 需要 ' + spec.arity + ' 个前提，当前选了 ' + premises.length + ' 个');
  }
  const P = premises.map((x) => x.f);
  const scopeOf = (list) => {
    const s = new Set();
    for (const f of list) {
      if (!f.scope) continue;
      for (const x of String(f.scope).split('|')) if (x) s.add(x);
    }
    return s;
  };
  // 作用域是否闭合：所用假设都必须仍在当前打开的子证明里
  const scopeClosed = (s) => [...s].every((id) => state.scopeStack.indexOf(id) >= 0);
  const out = (f, extra = {}) => {
    const sc = extra.scope !== undefined ? extra.scope : mergeScope(premises);
    return { f, rule: req.rule, terms: extra.terms || [], scope: sc, pick: extra.pick };
  };
  const mergeScope = (list) => {
    const s = scopeOf(list);
    return s.size ? [...s].sort().join('|') : null;
  };

  switch (req.rule) {
    case 'hyp': return out(P[0]);
    case 'andI':
      if (P[0].k !== 'and' && P[1].k !== 'and') return out(and(P[0], P[1]));
      throw new RuleError('∧I 的前提不应已经是合取式');
    case 'andE': {
      if (P[0].k !== 'and') throw new RuleError('∧E 需要一个合取式前提 A ∧ B');
      const pick = req.pick === '右' ? 1 : req.pick === '左' ? 0 : null;
      if (pick === null) throw new RuleError('∧E 需要选择取左边还是右边');
      return out(pick === 0 ? P[0].a : P[0].b, { pick: req.pick });
    }
    case 'orI': {
      if (!req.formula) throw new RuleError('∨I 需要给出要或上的另一支');
      const target = req.formula;
      if (target.k !== 'or') throw new RuleError('∨I 的结果必须是 A ∨ B 形式');
      if (alphaEq(target.a, P[0]) || alphaEq(target.b, P[0])) return out(target);
      throw new RuleError('∨I：' + fstr(P[0]) + ' 不是 ' + fstr(target) + ' 的析取支');
    }
    case 'orE': {
      const [d, i1, i2] = P;
      if (d.k !== 'or') throw new RuleError('∨E 的第一个前提应是 A ∨ B');
      const branches = [[i1, d.a], [i2, d.b]];
      for (const [im, want] of branches) {
        if (im.k !== 'imp' || !alphaEq(im.a, want)) {
          throw new RuleError('∨E 需要两支蕴含：' + fstr(want) + ' → C，当前给出 ' + fstr(im));
        }
      }
      if (!alphaEq(i1.b, i2.b)) throw new RuleError('∨E 两支的结论必须相同');
      return out(i1.b);
    }
    case 'impE': {
      const i = P.find((x) => x.k === 'imp');
      if (!i) throw new RuleError('→E 需要一个蕴含式前提 A → B');
      const other = P[0] === i ? P[1] : P[0];
      if (!alphaEq(i.a, other)) throw new RuleError('→E 不匹配：需要 ' + fstr(i.a) + '，手上有 ' + fstr(other));
      return out(i.b);
    }
    case 'impI': case 'negI': case 'raa': {
      if (P.length !== 1) throw new RuleError('该规则需要恰好一个已推导出的事实');
      const s = scopeOf(premises);
      if (s.size === 0) throw new RuleError('这条规则必须在一个假设（子证明）内使用：请先在“假设”面板打开子证明');
      if (!scopeClosed(s)) throw new RuleError('所依赖的假设已经合上，不能再用了');
      const scopeId = state.scopeStack[state.scopeStack.length - 1];   // 合上最内层子证明
      let assumed = state.assumptions && state.assumptions[scopeId];
      if (!assumed) {
        const hf = state.facts.find((f) => f.scope === scopeId && f.rule === 'assume');
        assumed = hf && hf.f;
      }
      if (!assumed) throw new RuleError('找不到假设 ' + scopeId);
      if (state.assumptions) delete state.assumptions[scopeId];   // 合上：该假设立即失效
      if (state.closedScopes && state.closedScopes.indexOf(scopeId) < 0) state.closedScopes.push(scopeId);
      if (req.rule === 'impI') return out(imp(assumed, P[0]), { scope: restScope(state, scopeId) });
      if (req.rule === 'negI') {
        if (!isBot(P[0])) throw new RuleError('¬I 需要推出矛盾 ⊥，当前是 ' + fstr(P[0]));
        if (assumed.k === 'not') throw new RuleError('¬I 的假设应是肯定式 A；想从 ¬A 推出 ⊥ 请用“反证法”');
        return out(not(assumed), { scope: restScope(state, scopeId) });
      }
      if (req.rule === 'raa') {
        if (!isBot(P[0])) throw new RuleError('反证法需要推出矛盾 ⊥，当前是 ' + fstr(P[0]));
        if (assumed.k !== 'not') throw new RuleError('反证法的假设应为 ¬A 形式，当前假设是 ' + fstr(assumed));
        return out(assumed.a, { scope: restScope(state, scopeId) });
      }
      throw new RuleError('内部错误');
    }
    case 'negE': {
      const n = P.find((x) => x.k === 'not');
      if (!n) throw new RuleError('¬E 需要一个否定式前提 ¬A');
      const other = P[0] === n ? P[1] : P[0];
      if (!alphaEq(n.a, other)) throw new RuleError('¬E 不匹配：¬' + fstr(n.a) + ' 与 ' + fstr(other));
      return out(BOT);
    }
    case 'allE': {
      if (P[0].k !== 'all') throw new RuleError('∀E 需要一个全称前提 ∀x, P');
      const t = req.term || v(state.freshName ? state.freshName() : 'c' + (++state.freshCount), true);
      return out(instAll(P[0], t), { terms: [t] });
    }
    case 'exI': {
      const t = req.term;
      if (!t) throw new RuleError('∃I 需要指明见证项 t');
      if (!(t.k === 'v' && t.free) && t.k !== 'n' && t.k !== 'c') throw new RuleError('∃I 的见证项应是变量或常量');
      const name = state.exName || (t.k === 'v' ? t.name : 'x');
      return out(ex(name, closeForEx(P[0], t, name)), { terms: [t] });
    }
    case 'eqRefl': {
      const t = req.term;
      if (!t) throw new RuleError('=I 需要指明项 t，得到 t = t');
      return out(eq(t, t), { terms: [t] });
    }
    case 'assertion': {
      // 内部使用：把玩家给出的具体数值命题登记为一条已证事实
      if (!req.formula) throw new RuleError('缺少要登记的命题');
      return out(req.formula);
    }
    case 'eqSym': {
      if (P[0].k !== 'eq') throw new RuleError('=Sym 需要一个等式前提');
      return out(eq(P[0].b, P[0].a));
    }
    case 'eqTrans': {
      const [e1, e2] = P;
      if (e1.k !== 'eq' || e2.k !== 'eq') throw new RuleError('=Trans 需要两个等式前提');
      if (termEq(e1.b, e2.a)) return out(eq(e1.a, e2.b));
      if (termEq(e2.b, e1.a)) return out(eq(e2.a, e1.b));
      throw new RuleError('=Trans 中间项不匹配：' + fstr(e1) + ' 与 ' + fstr(e2));
    }
    case 'eqRewrite': {
      const e = P.find((x) => x.k === 'eq');
      if (!e) throw new RuleError('=Sub 需要一个等式前提 a = b');
      const target = P[0] === e ? P[1] : P[0];
      const safe = new Set();
      for (const fact of state.facts) {
        const sym = symbolsIn(fact.f);
        for (const n of sym.vars) safe.add(n);
      }
      // pick = '左'/'右'：只在指定的一侧找替换；该方向无解时自动改用反向等式（a=b 与 b=a 等价）
      const side = req.pick === '左' || req.pick === '右' ? req.pick : undefined;
      const collect = (from, to) => {
        const raw = rewriteOptions(target, from, to, safe, side);
        const uniq = [];
        for (const w of raw) if (!uniq.some((x) => alphaEq(x, w))) uniq.push(w);
        return uniq;
      };
      let opts = collect(e.a, e.b);
      if (opts.length === 0) opts = collect(e.b, e.a);
      if (opts.length === 0) throw new RuleError('=Sub 在该公式中找不到可替换的出现');
      // 指定了结果式就按结果式挑选；否则只在唯一结果时自动完成
      let chosen = req.formula ? opts.find((x) => alphaEq(x, req.formula)) : null;
      if (!chosen && !req.formula) {
        if (opts.length === 1) chosen = opts[0];
        else throw new RuleError('=Sub 有 ' + opts.length + ' 种替换结果，请选择要用的结果式：' + opts.map((o) => fstr(o)).join(' / '));
      }
      if (!chosen) throw new RuleError('=Sub 的替换结果与指定公式不一致');
      return out(chosen, { terms: [e.a, e.b] });
    }
    case 'iffI': {
      const [i1, i2] = P;
      if (i1.k !== 'imp' || i2.k !== 'imp') throw new RuleError('↔I 需要两个蕴含式');
      if (!alphaEq(i1.a, i2.b) || !alphaEq(i1.b, i2.a)) throw new RuleError('↔I 两个蕴含方向必须互反');
      return out(iff(i1.a, i1.b));
    }
    case 'iffE': {
      if (P[0].k !== 'iff') throw new RuleError('↔E 需要一个等价式前提 A ↔ B');
      const dir = req.pick === '←' ? 1 : 0;
      return out(dir === 0 ? imp(P[0].a, P[0].b) : imp(P[0].b, P[0].a), { pick: req.pick });
    }
    case 'excludedMiddle': {
      const f = req.formula;
      if (!f || f.k !== 'or') throw new RuleError('排中律的形式是 A ∨ ¬A');
      const negSide = f.a.k === 'not' ? f.a : (f.b.k === 'not' ? f.b : null);
      if (!negSide) throw new RuleError('排中律要求其中一边是否定：A ∨ ¬A');
      const plain = negSide === f.a ? f.b : f.a;
      // 注意：这里比的是公式（命题），必须用 alphaEq；termEq 只适用于项
      if (!alphaEq(negSide.a, plain)) throw new RuleError('排中律要求两边是同一个命题的正反：A ∨ ¬A');
      return out(f);
    }
    case 'eqOpTerm': {
      if (P[0].k !== 'eq') throw new RuleError('“两边同加/乘一个式子”需要一个等式前提');
      const op = req.op && req.op.name;
      const t = req.op && req.op.term;
      if (!t) throw new RuleError('缺少要与两边同时运算的项');
      if (op === 'add') return out(eq(c0('add', P[0].a, t), c0('add', P[0].b, t)), { terms: [t] });
      if (op === 'mul') return out(eq(c0('mul', P[0].a, t), c0('mul', P[0].b, t)), { terms: [t] });
      throw new RuleError('“两边同加/乘一个式子”只支持 加 / 乘');
    }
    case 'eqOp': {
      if (P[0].k !== 'eq') throw new RuleError('“两边同时运算”需要一个等式前提');
      const opName = req.op && req.op.name;
      const op = EQUATION_OPS[opName];
      if (!op) throw new RuleError('未知的运算: ' + opName + '（支持 加/减/乘/除/取负/平方）');
      if (opName === 'div' && (!Number.isFinite(req.op.n) || req.op.n === 0)) throw new RuleError('不能两边同除以 0');
      const a = op(P[0].a, req.op.n);
      const b = op(P[0].b, req.op.n);
      return out(eq(a, b), { terms: [lit(req.op.n)] , op: req.op });
    }
    case 'arith': {
      const rel = P[0];
      if (rel.k === 'eq') {
        const a = evalConcrete(rel.a), b = evalConcrete(rel.b);
        if (a === null || b === null) throw new RuleError('数值计算：两边必须都是具体数字（可含 + - * / |·| 乘方）');
        if (a !== b) throw new RuleError('数值计算：' + a + ' ≠ ' + b);
        // keepLeft：保留左边原式、右边给具体值（用于“把子式换成它的值”当桥梁）
        // 注意要在“两边相同就返回”之前判断，否则 -(-3) = -(-3) 这种会被原样返回
        if (req.keepLeft) return out(eq(rel.a, lit(b)));
        if (termEq(rel.a, rel.b)) return out(rel);
        if (rel.a.k === 'n' && rel.b.k === 'n') return out(rel);
        return out(eq(lit(a), lit(b)));
      }
      if (rel.k === 'atom' && ['lt', 'le', 'gt', 'ge'].indexOf(rel.name) >= 0) {
        const a = evalConcrete(rel.args[0]), b = evalConcrete(rel.args[1]);
        if (a === null || b === null) throw new RuleError('数值计算：两边必须都是具体数字');
        const ok = rel.name === 'lt' ? a < b : rel.name === 'le' ? a <= b : rel.name === 'gt' ? a > b : a >= b;
        if (!ok) throw new RuleError('数值计算：' + a + ' 与 ' + b + ' 不满足 ' + REL[rel.name]);
        return out(rel);
      }
      if (rel.k === 'not' && rel.a.k === 'eq') {
        const a = evalConcrete(rel.a.a), b = evalConcrete(rel.a.b);
        if (a === null || b === null) throw new RuleError('数值计算：两边必须都是具体数字');
        if (a === b) throw new RuleError('数值计算：' + a + ' = ' + b + '，不能断言不等');
        return out(rel);
      }
      throw new RuleError('数值计算只能用于等式或不等式的具体数值验证');
    }
    case 'ring': {
      if (P[0].k !== 'eq') throw new RuleError('代数化简需要一个等式前提');
      const pa = polyOfTerm(P[0].a), pb = polyOfTerm(P[0].b);
      if (pa && pb) {
        // 两边都能化成多项式：若同为一个多项式，则输出“两边都化简后”的规范等式
        const same = pa.size === pb.size && [...pa].every(([k, val]) => {
          const w = pb.get(k);
          return w && w.n === val.n && w.d === val.d;
        });
        if (!same) throw new RuleError('代数化简：两边不是同一个多项式，等式不成立');
        // 若给出的两个式子写法不同，就把左边化简成与右边一致的形式（像纸笔演算那样）
        if (!termEq(P[0].a, P[0].b)) return out({ k: 'eq', a: polyToTerm(pa), b: P[0].b });
        // 两边写法相同：化简后给出结论（例如 2x+2x = 2x+2x ⟹ 4x = 4x）
        return out({ k: 'eq', a: polyToTerm(pa), b: polyToTerm(pb) });
      }
      const ok = ringEqual(P[0].a, P[0].b);
      if (ok === null) throw new RuleError('代数化简：暂不支持出现除法/绝对值/集合的式子（请用 =Sub 手工替换）');
      if (!ok) throw new RuleError('代数化简：两边不是同一个多项式，等式不成立');
      return out({ k: 'eq', a: P[0].a, b: P[0].b });
    }
    default: throw new RuleError('规则 ' + req.rule + ' 尚未实现');
  }
}

// 合上最内层子证明后，结论仍依赖外层假设
function restScope(state, scopeId) {
  const rest = state.scopeStack.filter((id) => id !== scopeId);
  return rest.length ? rest.join('|') : null;
}

// ∃I 专用：把见证项 t 在公式中“闭合”成 ∃x
function closeForEx(f, t, name) {
  const BT_ = f;
  const sub = openAtInverse(f, t, name);
  return sub;
}
function openAtInverse(f, t, name) {
  // 用 closeAt 逻辑：把自由变量 t 的名字绑定到新的 ∃
  // 这里直接复用 closeAt 的语义（避免循环依赖）
  return closeAtFormula(f, t.name, name);
}
function closeAtFormula(f, fvName, bindName) {
  const rec = (node, depth) => {
    switch (node.k) {
      case 'atom': return atom(node.name, ...node.args.map((t) => recT(t, depth)));
      case 'eq': return eq(recT(node.a, depth), recT(node.b, depth));
      case 'not': return not(rec(node.a, depth));
      case 'and': return and(rec(node.a, depth), rec(node.b, depth));
      case 'or': return or(rec(node.a, depth), rec(node.b, depth));
      case 'imp': return imp(rec(node.a, depth), rec(node.b, depth));
      case 'iff': return iff(rec(node.a, depth), rec(node.b, depth));
      case 'all': return all(node.name, rec(node.body, depth + 1));
      case 'ex': return ex(node.name, rec(node.body, depth + 1));
      default: return node;
    }
  };
  const recT = (t, depth) => {
    switch (t.k) {
      case 'v': return (t.free && t.name === fvName) ? { k: 'b', i: depth } : t;
      case 'c': return c0(t.name, ...t.args.map((x) => recT(x, depth)));
      default: return t;
    }
  };
  return rec(f, 0);
}

/* ---------- 假设作用域 ---------- */
export function openAssumption(state, formula, label) {
  const id = 'H' + (++state.assumeCount);
  state.assumptions = state.assumptions || {};
  state.assumptions[id] = formula;
  const fact = { id: 'a' + state.nextId++, f: formula, rule: 'assume', from: [], scope: id, name: label || ('假设 ' + id) };
  state.facts.push(fact);
  return fact;
}

/* ---------- 生成新事实 ---------- */
export function makeFact(state, res, fromIds, forceId) {
  const fact = {
    id: forceId || ('f' + state.nextId++),
    f: res.f,
    rule: res.rule,
    from: fromIds || [],
    terms: res.terms || [],
    scope: res.scope ?? null,
    pick: res.pick,
  };
  state.facts.push(fact);
  return fact;
}
export function factText(state, fact) {
  if (fact.rule === 'assume') return '假设：' + fstr(fact.f);
  if (fact.rule === 'hyp') return '引用前提';
  const spec = RULES[fact.rule];
  const terms = (fact.terms || []).map((t) => termStr(t)).join('、');
  return (spec ? spec.name : fact.rule) + (terms ? ' [' + terms + ']' : '');
}

/* ---------- 可点击的项候选 ---------- */
export function termCandidates(state) {
  const seen = new Map();
  const add = (t) => {
    const s = termStr(t);
    if (!seen.has(s)) seen.set(s, t);
  };
  for (const f of state.facts) {
    const sym = symbolsIn(f.f);
    for (const name of sym.vars) add(v(name, true));
    for (const name of sym.funcs) {
      if (name === 'add' || name === 'mul' || name === 'sub' || name === 'div') continue;
      add(c0(name, v('x', true)));
    }
  }
  add(v('x', true)); add(v('y', true)); add(v('z', true));
  return [...seen.entries()].map(([s, t]) => ({ label: s, term: t }));
}
