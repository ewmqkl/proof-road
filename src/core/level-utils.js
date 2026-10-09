// core/level-utils.js —— 把关卡定义编译成可用的记号表 / 公式 / 公理
import { parse, parseLenient, makeSig, freeVars } from './logic.js';
import { buildAxioms } from '../data/axioms.js';

const ATOM_NAME_RE = /^[A-Z][A-Za-z0-9']*$/;
export const EXTRA_PREDS = { subset: { arity: 2 }, mono: { arity: 1 }, even: { arity: 1 }, odd: { arity: 1 } };

// 先验：单字母大写 A–Z 与小写 p–z 优先当作命题原子
const SEED_ATOMS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').concat('p q r s t u v w'.split(' '));

export function buildSigForLevel(level) {
  const atoms = new Set(SEED_ATOMS.concat(level.atoms || []));
  const scanSig = () => makeSig({ atoms: [], preds: { ...EXTRA_PREDS, ...(level.preds || {}) } });
  for (const src of [...(level.premises || []), level.goal, ...(level.extraFormulas || [])]) {
    try {
      const f = parseLenient(src, scanSig());
      scanAtoms(f, atoms);
    } catch (e) { throw new Error('关卡 ' + level.id + ' 的公式解析失败：' + e.message + '  ←  ' + src); }
  }
  for (const set of level.axiomSets || []) {
    const ax = buildAxioms([set], makeSig({ atoms: [], preds: { ...EXTRA_PREDS, ...(level.preds || {}) } }), { pick: level.axiomPick });
    for (const a of ax) scanAtoms(a.f, atoms);
  }
  return makeSig({ atoms: [...atoms], funcs: level.funcs || {}, preds: { ...EXTRA_PREDS, ...(level.preds || {}) } });
}
function scanAtoms(f, out) {
  switch (f.k) {
    case 'atom': if (ATOM_NAME_RE.test(f.name) && f.args.length === 0) out.add(f.name); f.args.forEach((t) => scanTermAtoms(t, out)); break;
    case 'eq': scanTermAtoms(f.a, out); scanTermAtoms(f.b, out); break;
    case 'not': scanAtoms(f.a, out); break;
    case 'and': case 'or': case 'imp': case 'iff': scanAtoms(f.a, out); scanAtoms(f.b, out); break;
    case 'all': case 'ex': scanAtoms(f.body, out); break;
  }
}
function scanTermAtoms(t, out) {
  if (t.k === 'v' && t.free && ATOM_NAME_RE.test(t.name)) out.add(t.name);
  if (t.k === 'c') t.args.forEach((a) => scanTermAtoms(a, out));
}

export function compileLevel(level) {
  const greedy = makeSig({ atoms: [] });
  const openVars = new Set();
  for (const src of [...(level.premises || []), level.goal]) {
    try { for (const n of freeVars(parseLenient(src, greedy))) openVars.add(n); } catch (e) { /* 正式解析时会报错 */ }
  }
  const sig = buildSigForLevel(level);
  const pOpts = { fixed: openVars };
  const parsedPremises = (level.premises || []).map((src) => ({ src, f: parse(src, sig, pOpts) }));
  const goal = parse(level.goal, sig, pOpts);
  const axioms = buildAxioms(level.axiomSets || [], sig, { pick: level.axiomPick });
  return { ...level, sig, pOpts, parsedPremises, goal, axioms, openVars };
}
