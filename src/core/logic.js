// core/logic.js —— 内核：项、公式、de Bruijn 绑定、替换、解析、打印
// 零依赖，浏览器与 Node 均可直接 import。

/* ============================ 1. 项 (Term) ============================ */

export const v = (name, free = false) => ({ k: 'v', name, free });
export const c0 = (name, ...args) => ({ k: 'c', name, args });
export const lit = (n) => ({ k: 'n', n });
export const B = (i) => ({ k: 'b', i });          // de Bruijn 索引，0 = 最内层
export const EV = (name) => ({ k: 'e', name });   // 元变量（证明中的待实例化占位）

/* ============================ 2. 公式 (Formula) ============================ */

export const TOP = { k: 'top' };
export const BOT = { k: 'bot' };
export const atom = (name, ...args) => ({ k: 'atom', name, args });
export const eq = (a, b) => ({ k: 'eq', a, b });
export const not = (a) => ({ k: 'not', a });
export const and = (a, b) => ({ k: 'and', a, b });
export const or = (a, b) => ({ k: 'or', a, b });
export const imp = (a, b) => ({ k: 'imp', a, b });
export const iff = (a, b) => ({ k: 'iff', a, b });
export const all = (name, body) => ({ k: 'all', name, body });
export const ex = (name, body) => ({ k: 'ex', name, body });

/* ==================== 3. 自由变量 / 元变量 工具 ==================== */

export function freeVarsOfTerm(t, acc = new Set()) {
  if (t.k === 'v' && t.free) acc.add(t.name);
  else if (t.k === 'e') acc.add(t.name);
  else if (t.k === 'c') for (const a of t.args) freeVarsOfTerm(a, acc);
  return acc;
}
export function freeVars(f, acc = new Set()) {
  switch (f.k) {
    case 'atom': for (const t of f.args) freeVarsOfTerm(t, acc); return acc;
    case 'eq': freeVarsOfTerm(f.a, acc); freeVarsOfTerm(f.b, acc); return acc;
    case 'not': return freeVars(f.a, acc);
    case 'and': case 'or': case 'imp': case 'iff':
      freeVars(f.a, acc); return freeVars(f.b, acc);
    case 'all': case 'ex': {
      const before = new Set(acc);
      freeVars(f.body, acc);
      for (const n of before) acc.delete(n);
      return acc;
    }
    default: return acc;
  }
}
export const isClosed = (f) => freeVars(f).size === 0;

/* ==================== 4. 替换 (打开 / 闭合) ==================== */

export function openAtTerm(t, idx, sub) {
  switch (t.k) {
    case 'b': return t.i === idx ? sub : (t.i > idx ? B(t.i - 1) : t);
    case 'c': return c0(t.name, ...t.args.map((a) => openAtTerm(a, idx, sub)));
    default: return t;
  }
}
export function openAt(f, idx, sub) {
  switch (f.k) {
    case 'atom': return atom(f.name, ...f.args.map((t) => openAtTerm(t, idx, sub)));
    case 'eq': return eq(openAtTerm(f.a, idx, sub), openAtTerm(f.b, idx, sub));
    case 'not': return not(openAt(f.a, idx, sub));
    case 'and': return and(openAt(f.a, idx, sub), openAt(f.b, idx, sub));
    case 'or': return or(openAt(f.a, idx, sub), openAt(f.b, idx, sub));
    case 'imp': return imp(openAt(f.a, idx, sub), openAt(f.b, idx, sub));
    case 'iff': return iff(openAt(f.a, idx, sub), openAt(f.b, idx, sub));
    case 'all': return all(f.name, openAt(f.body, idx + 1, sub));
    case 'ex': return ex(f.name, openAt(f.body, idx + 1, sub));
    default: return f;
  }
}
export function closeAtTerm(t, idx, name) {
  switch (t.k) {
    case 'b': return t.i >= idx ? B(t.i + 1) : t;
    case 'v': return (t.free && t.name === name) ? B(idx) : t;
    case 'c': return c0(t.name, ...t.args.map((a) => closeAtTerm(a, idx, name)));
    default: return t;
  }
}
export function closeAt(f, idx, name) {
  switch (f.k) {
    case 'atom': return atom(f.name, ...f.args.map((t) => closeAtTerm(t, idx, name)));
    case 'eq': return eq(closeAtTerm(f.a, idx, name), closeAtTerm(f.b, idx, name));
    case 'not': return not(closeAt(f.a, idx, name));
    case 'and': return and(closeAt(f.a, idx, name), closeAt(f.b, idx, name));
    case 'or': return or(closeAt(f.a, idx, name), closeAt(f.b, idx, name));
    case 'imp': return imp(closeAt(f.a, idx, name), closeAt(f.b, idx, name));
    case 'iff': return iff(closeAt(f.a, idx, name), closeAt(f.b, idx, name));
    case 'all': return all(f.name, closeAt(f.body, idx + 1, name));
    case 'ex': return ex(f.name, closeAt(f.body, idx + 1, name));
    default: return f;
  }
}
export const instAll = (f, t) => openAt(f.body, 0, t);
export const genEx = (f, fvName, witness) => ex(fvName, closeAt(f, 0, witness.name));

/* ==================== 5. α 等价 ==================== */

export function termEq(a, b) {
  if (a === b) return true;
  if (a.k !== b.k) return false;
  switch (a.k) {
    case 'b': return a.i === b.i;
    case 'n': return a.n === b.n;
    case 'v': return a.name === b.name && a.free === b.free;
    case 'e': return a.name === b.name;
    case 'c': return a.name === b.name && a.args.length === b.args.length && a.args.every((x, i) => termEq(x, b.args[i]));
    default: return false;
  }
}
export function alphaEq(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a.k !== b.k) return false;
  // 项也带 k 字段：交给 termEq，避免把 a = b 与 b = c 判成不等
  if (TERM_KINDS.has(a.k)) return termEq(a, b);
  switch (a.k) {
    case 'top': case 'bot': return true;
    case 'atom': return a.name === b.name && a.args.length === b.args.length && a.args.every((x, i) => termEq(x, b.args[i]));
    case 'eq': return termEq(a.a, b.a) && termEq(a.b, b.b);
    case 'not': return alphaEq(a.a, b.a);
    case 'and': case 'or': case 'imp': case 'iff': return alphaEq(a.a, b.a) && alphaEq(a.b, b.b);
    case 'all': case 'ex': return alphaEq(a.body, b.body);
    default: return false;
  }
}

/* ==================== 6. 打印 ==================== */

const TERM_KINDS = new Set(['v', 'n', 'c', 'b', 'e']);
const PREC = { iff: 1, imp: 2, or: 3, and: 4, not: 5, cmp: 6, add: 7, mul: 8, post: 9, atom: 10 };
const INFIX = { add: '+', sub: '-', mul: '*', div: '/' };
const REL = { lt: '<', le: '≤', gt: '>', ge: '≥' };

function ctxName(ctx, i) { return ctx[i] !== undefined ? ctx[i] : ('x' + (i + 1)); }
function wrap(s, p, outer) { return p < outer ? '(' + s + ')' : s; }

// force = 是否必须加括号（由调用方根据优先级与结合方向决定）。
// 每个节点的括号需求只由“父级要求”决定，绝不把父级要求继续传给子节点，
// 否则会出现 x * (x + x) 被打印成 x * x + x 这类错误。
export function termStr(t, ctx = [], force = false) {
  const par = (s) => (force ? '(' + s + ')' : s);
  switch (t.k) {
    case 'b': return ctxName(ctx, t.i);
    case 'v': case 'e': return t.name;
    case 'n': return String(t.n);                  // 原子：无需括号
    case 'c': {
      const name = t.name, args = t.args;
      if (INFIX[name] && args.length === 2) {
        // 左结合（+ - * /）：左孩子同级可省（依赖左结合重解析），右孩子同级必须括
        const rel = (name === 'add' || name === 'sub') ? PREC.add : PREC.mul;
        const needLeft = isLooser(args[0], rel);
        const needRight = !isTighter(args[1], rel);
        const s = termStr(args[0], ctx, needLeft) + ' ' + INFIX[name] + ' ' + termStr(args[1], ctx, needRight);
        return par(s);
      }
      if (name === 'neg' && args.length === 1) return par('-' + termStr(args[0], ctx, true));
      // 后缀运算：底数必须是一元项，否则加括号（(2 + 3)² 不能写成 2 + 3²）
      if (name === 'sq' && args.length === 1) return par(termStr(args[0], ctx, true) + '²');
      if (name === 'pow' && args.length === 2) return par(termStr(args[0], ctx, false) + '^' + termStr(args[1], ctx, false));
      if (args.length === 0) return name;
      if (name === 'abs' && args.length === 1) return par('|' + termStr(args[0], ctx, false) + '|');
      if (name === 'set') return par('{' + args.map((a) => termStr(a, ctx, false)).join(', ') + '}');
      return par(name + '(' + args.map((a) => termStr(a, ctx, false)).join(', ') + ')');
    }
    default: return '?';
  }
}
// 顶层结合力：null = 原子/后缀/函数调用（最紧），否则为中缀运算符的结合力
function topLevel(t) {
  if (t.k !== 'c') return null;
  if (INFIX[t.name] && t.args.length === 2) return (t.name === 'add' || t.name === 'sub') ? PREC.add : PREC.mul;
  if (t.name === 'neg') return PREC.mul;
  return null;
}
function isLooser(t, rel) { const lvl = topLevel(t); return lvl !== null && lvl < rel; }
function isTighter(t, rel) { const lvl = topLevel(t); return lvl === null || lvl > rel; }

// 公式打印：只有双子句的连接词才需要“更紧才免括号”，一元连接词与量词内部一律完整打印。
// 这样 (2 + 3) = 5 不会被写成 2 + 3 = 5 那种丢括号的形式。
export function fstr(f, ctx = [], force = false) {
  const par = (s) => (force ? '(' + s + ')' : s);
  switch (f.k) {
    case 'top': return '⊤';
    case 'bot': return '⊥';
    case 'atom': {
      const name = f.name, args = f.args;
      if (name === 'mem' && args.length === 2) return par(termStr(args[0], ctx, pr(f.args[0])) + ' ∈ ' + termStr(args[1], ctx, pr(f.args[1])));
      if (REL[name] && args.length === 2) return par(termStr(args[0], ctx, pr(f.args[0])) + ' ' + REL[name] + ' ' + termStr(args[1], ctx, pr(f.args[1])));
      if (args.length === 0) return name;
      return par(name + '(' + args.map((a) => termStr(a, ctx, false)).join(', ') + ')');
    }
    case 'eq': return par(termStr(f.a, ctx, pr(f.a)) + ' = ' + termStr(f.b, ctx, pr(f.b)));
    case 'not': return par('¬' + fstr(f.a, ctx, true));
    case 'and': case 'or': case 'imp': case 'iff': {
      const lvl = { and: PREC.and, or: PREC.or, imp: PREC.imp, iff: PREC.iff }[f.k];
      const sym = { and: ' ∧ ', or: ' ∨ ', imp: ' → ', iff: ' ↔ ' }[f.k];
      // 子公式必须“本来就比本连接词更紧”才免括号：这样 A ∧ (B ∨ A) 不会退化成 A ∧ B ∨ A
      const needParen = (child) => {
        const cl = fLevel(child);
        return cl !== null && cl <= lvl;
      };
      return par(fstr(f.a, ctx, needParen(f.a)) + sym + fstr(f.b, ctx, needParen(f.b)));
    }
    case 'all': return par('∀' + f.name + ', ' + fstr(f.body, [f.name].concat(ctx), false));
    case 'ex': return par('∃' + f.name + ', ' + fstr(f.body, [f.name].concat(ctx), false));
    default: return '?';
  }
}
// 关系原子里的项：解析器会一直读到关系符号为止，因此加减法也不必加括号（课本写法 x + 0 = x）
function pr(t) { return false; }
// 公式顶层结合力；null = 原子/否定/量词（最紧）
function fLevel(f) {
  switch (f.k) {
    case 'and': return PREC.and;
    case 'or': return PREC.or;
    case 'imp': return PREC.imp;
    case 'iff': return PREC.iff;
    default: return null;
  }
}
export const P = (f) => fstr(f);

/* 语义等价的规范键：忽略 free 提示位（它只影响解析时的归类，不改变含义），
   保留 de Bruijn 索引以维持绑定结构。用于比较“两个项/公式是不是同一个”。 */
export function termKey(t) {
  switch (t.k) {
    case 'v': return 'v:' + t.name;   // free 只是解析提示，不影响含义
    case 'e': return 'e:' + t.name;
    case 'b': return 'b:' + t.i;
    case 'n': return 'n:' + t.n;
    case 'c': return 'c:' + t.name + '(' + t.args.map(termKey).join(',') + ')';
    default: return '?';
  }
}
export function fkey(f) {
  switch (f.k) {
    case 'top': case 'bot': return f.k;
    case 'atom': return 'a:' + f.name + '(' + f.args.map(termKey).join(',') + ')';
    case 'eq': return 'eq:' + termKey(f.a) + '=' + termKey(f.b);
    case 'not': return 'not(' + fkey(f.a) + ')';
    case 'and': case 'or': case 'imp': case 'iff': return f.k + '(' + fkey(f.a) + ',' + fkey(f.b) + ')';
    case 'all': case 'ex': return f.k + '(' + fkey(f.body) + ')';
    default: return '?';
  }
}

export function symbolsInTerm(t, out = { vars: new Set(), funcs: new Set() }) {
  if (t.k === 'v' || t.k === 'e') out.vars.add(t.name);
  else if (t.k === 'c') { out.funcs.add(t.name); t.args.forEach((a) => symbolsInTerm(a, out)); }
  return out;
}
export function symbolsIn(f, out = { vars: new Set(), funcs: new Set() }) {
  switch (f.k) {
    case 'atom': f.args.forEach((t) => symbolsInTerm(t, out)); break;
    case 'eq': symbolsInTerm(f.a, out); symbolsInTerm(f.b, out); break;
    case 'not': symbolsIn(f.a, out); break;
    case 'and': case 'or': case 'imp': case 'iff': symbolsIn(f.a, out); symbolsIn(f.b, out); break;
    case 'all': case 'ex': symbolsIn(f.body, out); break;
  }
  return out;
}

/* ==================== 7. 记号表 (Signature) ==================== */

export const DEFAULT_SIG = {
  atoms: [],
  funcs: {
    add: { arity: 2 }, sub: { arity: 2 }, mul: { arity: 2 }, div: { arity: 2 },
    neg: { arity: 1 }, abs: { arity: 1 }, sq: { arity: 1 },
  },
  preds: {
    lt: { arity: 2 }, le: { arity: 2 }, gt: { arity: 2 }, ge: { arity: 2 }, mem: { arity: 2 },
  },
  consts: ['0', '1'],
};
export function makeSig(extra = {}) {
  return {
    atoms: (DEFAULT_SIG.atoms || []).concat(extra.atoms || []),
    funcs: Object.assign({}, DEFAULT_SIG.funcs, extra.funcs || {}),
    preds: Object.assign({}, DEFAULT_SIG.preds, extra.preds || {}),
    consts: DEFAULT_SIG.consts.concat(extra.consts || []),
  };
}

/* ==================== 8. 词法 ==================== */

const MULTI = ['<->', '<-', '->', '/\\', '\\/', '!=', '<=', '>=', '=>', '<>'];
const SYMBOLS = '()[],.:∀∃¬∧∨→↔∈≤≥≠=+-*/^<>|²√⊤⊥';
const KEYWORDS = new Set(['forall', 'exists', 'all', 'ex', 'and', 'or', 'not', 'imp', 'iff', 'true', 'false']);

export function lex(src) {
  const toks = [];
  let i = 0;
  const push = (type, value) => toks.push({ type, value });
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    let matched = false;
    for (const m of MULTI) {
      if (src.startsWith(m, i)) { push('punc', m); i += m.length; matched = true; break; }
    }
    if (matched) continue;
    if (SYMBOLS.indexOf(ch) >= 0) { push('punc', ch); i++; continue; }
    if (/[0-9]/.test(ch)) {
      let j = i; while (j < src.length && /[0-9]/.test(src[j])) j++;
      push('num', src.slice(i, j)); i = j; continue;
    }
    if (/[A-Za-z_\u4e00-\u9fff]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_'\u4e00-\u9fff]/.test(src[j])) j++;   // ∀/∃ 只作单字符量词记号
      push('ident', src.slice(i, j)); i = j; continue;
    }
    throw new Error('无法识别的字符: ' + ch + ' (位置 ' + i + ')');
  }
  return toks;
}

/* ==================== 9. 语法分析 ==================== */

export class Parser {
  constructor(src, sig = makeSig(), opts = {}) {
    this.toks = lex(src);
    this.i = 0;
    this.sig = sig;
    this.opts = opts;
    this.lenient = !!opts.lenient;   // 探测模式：允许未登记的裸变量充当命题原子
    this.bound = [];
  }
  peek(o = 0) { return this.toks[this.i + o]; }
  at(type, value) { const t = this.peek(); return !!t && t.type === type && (value === undefined || t.value === value); }
  accept(type, value) { if (this.at(type, value)) { this.i++; return true; } return false; }
  expect(type, value) {
    if (!this.accept(type, value)) {
      const t = this.peek();
      throw new Error('期望 ' + (value !== undefined ? value : type) + '，实际遇到 ' + (t ? JSON.stringify(t.value) : '结束'));
    }
  }
  name() {
    const t = this.peek();
    if (!t || (t.type !== 'ident' && t.type !== 'num')) throw new Error('期望标识符，实际遇到 ' + (t ? JSON.stringify(t.value) : '结束'));
    this.i++;
    return t.value;
  }
  sigLookup(name, kind) { return this.sig[kind] && Object.prototype.hasOwnProperty.call(this.sig[kind], name) ? this.sig[kind][name] : null; }
  atomArity(name) { const p = this.sigLookup(name, 'preds'); return p ? p.arity : null; }
  // 命题原子名：零元谓词，或 sig.atoms 中登记的名字（如 A、B、P、Q）
  isAtomName(name) {
    if (this.atomArity(name) === 0) return true;
    return Array.isArray(this.sig.atoms) && this.sig.atoms.indexOf(name) >= 0;
  }
  isVarName(name) {
    if (this.bound.indexOf(name) >= 0) return true;
    if (this.opts.fixed && this.opts.fixed.has(name)) return false;
    if (this.sigLookup(name, 'funcs') || this.sigLookup(name, 'preds')) return false;
    if (this.sig.consts.indexOf(name) >= 0) return false;
    if (KEYWORDS.has(name)) return false;
    return true;
  }

  parseTerm() { return this.pAdd(); }
  pAdd() {
    const __i0 = this.i;
    let left = this.pMul();
    if (globalThis.__DBG_PAREN) console.log('[pAdd] start=' + __i0 + ' afterMul=' + this.i + ' peek=' + JSON.stringify(this.peek()));
    while (this.at('punc', '+') || this.at('punc', '-')) {
      const op = this.peek().value; this.i++;
      const right = this.pMul();
      left = c0(op === '+' ? 'add' : 'sub', left, right);
    }
    return left;
  }
  pMul() {
    let left = this.pUnary();
    while (this.at('punc', '*') || this.at('punc', '/')) {
      const op = this.peek().value; this.i++;
      const right = this.pUnary();
      left = c0(op === '*' ? 'mul' : 'div', left, right);
    }
    return left;
  }
  pUnary() { return this.pPow(); }
  pPow() {
    // 幂右结合，且优先级高于一元负号：-x² = -(x²)
    let base = this.pAtomTerm();
    let sq = false;
    while (true) {
      if (this.at('punc', '²')) { this.i++; sq = true; continue; }
      if (this.at('punc', '^')) {
        this.i++;
        const exp = this.pPow();
        if (exp.k === 'n' && exp.n === 2) sq = true;
        else base = c0('pow', base, exp);
        continue;
      }
      break;
    }
    if (sq) base = c0('sq', base);
    return base;
  }
  pAtomTerm() {
    const t = this.peek();
    if (globalThis.__DBG_PAREN) console.log('[atom] i=' + this.i + ' tok=' + JSON.stringify(t));
    if (!t) throw new Error('项表达式意外结束');
    if (t.type === 'num') { this.i++; return lit(Number(t.value)); }
    if (t.type === 'punc' && t.value === '-') {   // 一元负号，作用于幂
      this.i++;
      return c0('neg', this.pPow());
    }
    if (t.type === 'punc' && t.value === '(') {
      this.i++;
      const inner = this.parseTerm();
      if (globalThis.__DBG_PAREN) console.log('[paren] inner=' + JSON.stringify(inner).slice(0,60) + ' i=' + this.i + ' peek=' + JSON.stringify(this.peek()));
      this.expect('punc', ')');
      return inner;
    }
    if (t.type === 'punc' && t.value === '[') {
      this.i++;
      const els = [];
      if (!this.at('punc', ']')) {
        els.push(this.parseTerm());
        while (this.accept('punc', ',')) els.push(this.parseTerm());
      }
      this.expect('punc', ']');
      return c0('set', ...els);
    }
    if (t.type === 'punc' && t.value === '|') {
      this.i++;
      const inner = this.parseTerm();
      this.expect('punc', '|');
      return c0('abs', inner);
    }
    if (t.type === 'ident') {
      this.i++;
      const n = t.value;
      if (this.at('punc', '(')) {
        const args = this.parseArgs();
        const f = this.sigLookup(n, 'funcs');
        if (!f && !this.sigLookup(n, 'preds')) throw new Error('未知函数符号: ' + n);
        if (f && f.arity !== undefined && f.arity !== args.length) throw new Error(n + ' 需要 ' + f.arity + ' 个参数，收到 ' + args.length);
        return c0(n, ...args);
      }
      const bIdx = this.bound.lastIndexOf(n);
      if (bIdx >= 0) return B(this.bound.length - 1 - bIdx);
      return v(n, this.isVarName(n));
    }
    throw new Error('无法解析项: ' + JSON.stringify(t.value));
  }
  parseArgs() {
    this.expect('punc', '(');
    const args = [];
    if (!this.at('punc', ')')) {
      args.push(this.parseTerm());
      while (this.accept('punc', ',')) args.push(this.parseTerm());
    }
    this.expect('punc', ')');
    return args;
  }

  parseFormula() { return this.pIff(); }
  pIff() {
    const left = this.pImp();
    if (this.at('punc', '↔') || this.at('punc', '<->') || this.at('ident', 'iff')) { this.i++; return iff(left, this.pIff()); }
    return left;
  }
  pImp() {
    const left = this.pOr();
    if (this.at('punc', '→') || this.at('punc', '->') || this.at('punc', '=>') || this.at('ident', 'imp')) { this.i++; return imp(left, this.pImp()); }
    return left;
  }
  pOr() {
    let left = this.pAnd();
    while (this.at('punc', '∨') || this.at('punc', '\\/') || this.at('ident', 'or')) { this.i++; left = or(left, this.pAnd()); }
    return left;
  }
  pAnd() {
    let left = this.pNot();
    while (this.at('punc', '∧') || this.at('punc', '/\\') || this.at('ident', 'and')) { this.i++; left = and(left, this.pNot()); }
    return left;
  }
  pNot() {
    if (this.at('punc', '¬')) { this.i++; return not(this.pNot()); }
    if (this.at('ident', 'not')) { this.i++; return not(this.pNot()); }
    return this.pAtomFormula();
  }
  pCmp() {
    let left = this.parseTerm();
    const t = this.peek();
    if (t && (t.type === 'punc')) {
      const s = t.value;
      if (s === '=') { this.i++; return eq(left, this.parseTerm()); }
      if (s === '≠' || s === '!=') { this.i++; return not(eq(left, this.parseTerm())); }
      if (s === '∈') { this.i++; return atom('mem', left, this.parseTerm()); }
      if (s === '<' || s === '≤' || s === '>' || s === '≥' || s === '<=' || s === '>=') {
        this.i++;
        const right = this.parseTerm();
        const map = { '<': 'lt', '≤': 'le', '>': 'gt', '≥': 'ge', '<=': 'le', '>=': 'ge' };
        return atom(map[s], left, right);
      }
    }
    while (this.at('punc', '²')) { this.i++; left = c0('sq', left); }
    if (left.k === 'c' && this.sigLookup(left.name, 'preds')) return atom(left.name, ...left.args);
    if (left.k === 'v' && left.free && (this.isAtomName(left.name) || this.lenient)) return atom(left.name);
    throw new Error('无法解析为公式: ' + JSON.stringify(termStr(left)) + '（命题原子，请在记号表中登记）');
  }
  pAtomFormula() {
    const t = this.peek();
    if (!t) throw new Error('公式意外结束');
    // 括号既可能是“(公式)”，也可能是“(项)”；先按公式试，失败则回退给项解析器
    if (t.type === 'punc' && t.value === '(') {
      const save = this.i;
      this.i++;
      try {
        const inner = this.parseFormula();
        this.expect('punc', ')');
        return inner;
      } catch (err) {
        this.i = save;
      }
    }
    if (t.type === 'punc' && t.value === '⊤') { this.i++; return TOP; }
    if (t.type === 'punc' && t.value === '⊥') { this.i++; return BOT; }
    if (t.type === 'ident' && (t.value === 'true')) { this.i++; return TOP; }
    if (t.type === 'ident' && (t.value === 'false')) { this.i++; return BOT; }
    if (t.type === 'ident' && (t.value === 'forall' || t.value === 'all')) { this.i++; return this.pQuant(true); }
    if (t.type === 'ident' && (t.value === 'exists' || t.value === 'ex')) { this.i++; return this.pQuant(false); }
    if (t.type === 'punc' && t.value === '∀') { this.i++; return this.pQuant(true); }
    if (t.type === 'punc' && t.value === '∃') { this.i++; return this.pQuant(false); }
    if (t.type === 'ident' && this.sigLookup(t.value, 'preds') && this.peek(1) && this.peek(1).value === '(') {
      this.i++;
      const args = this.parseArgs();
      return atom(t.value, ...args);
    }
    return this.pCmp();
  }
  pQuant(isAll) {
    const vars = [];
    vars.push(this.name());
    while (this.at('ident') && !KEYWORDS.has(this.peek().value)) vars.push(this.name());
    // 分隔符：'.' / ':' / '->'；或逗号（此时逗号即分隔符，后接公式体）
    const hadComma = this.accept('punc', ',');
    const hadDot = this.accept('punc', '.') || this.accept('punc', ':') || this.accept('punc', '=>') || this.accept('punc', '->');
    if (!hadComma && !hadDot) {
      throw new Error('量词 ' + vars.join(' ') + ' 后期望 "." / ":" / "->" / ","');
    }
    for (const n of vars) this.bound.push(n);
    let body = this.parseFormula();
    for (let k = 0; k < vars.length; k++) this.bound.pop();

    for (let k = vars.length - 1; k >= 0; k--) body = isAll ? all(vars[k], body) : ex(vars[k], body);
    return body;
  }
}

export function parse(src, sig = makeSig(), opts = {}) {
  const p = new Parser(src, sig, opts);
  const f = p.parseFormula();
  if (p.i !== p.toks.length) throw new Error('公式解析后仍有多余记号: ' + JSON.stringify(p.peek() && p.peek().value));
  return f;
}
export function parseTerm(src, sig = makeSig(), opts = {}) {
  const p = new Parser(src, sig, opts);
  const t = p.parseTerm();
  if (p.i !== p.toks.length) throw new Error('项解析后仍有多余记号: ' + JSON.stringify(p.peek() && p.peek().value));
  return t;
}
// 宽松解析：把任何裸自由变量当作命题原子（用于自动识别关卡里的原子名）
export function parseLenient(src, sig = makeSig(), opts = {}) {
  return parse(src, sig, { ...opts, lenient: true });
}

export function parseDecl(src, sig = makeSig(), opts = {}) {
  const p = new Parser(src, sig, opts);
  const t = p.parseTerm();
  if (p.i === p.toks.length) {
    if (t.k === 'c' && sig.preds && sig.preds[t.name]) return { kind: 'atom', value: atom(t.name, ...t.args) };
    return { kind: 'term', value: t };
  }
  return { kind: 'formula', value: parse(src, sig, opts) };
}
