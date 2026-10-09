// tools/solve-cli.mjs —— 用解算器给关卡搜证明，并独立验证
// 用法：node tools/solve-cli.mjs [关卡...] [--depth 8] [--budget 20000] [--ms 15000] [--json]
import { compileLevel } from '../src/core/level-utils.js';
import { LEVELS } from '../src/data/levels.js';
import { findProof } from '../src/core/solver.js';
import { P } from '../src/core/logic.js';
import { createState, applyStep, matchedFact } from '../src/core/proof.js';

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v && !String(v).startsWith('--') ? Number(v) : true;
};
const asJson = argv.includes('--json');
const maxDepth = Number(flag('depth', 8));
const budget = Number(flag('budget', 20000));
const timeMs = Number(flag('ms', 15000));
const wanted = argv.filter((a) => !String(a).startsWith('--') && !/^\d+$/.test(a));
const targets = wanted.length ? wanted.map((id) => LEVELS.find((l) => l.id === id)).filter(Boolean) : LEVELS;

/** 把搜到的步骤在真实关卡状态上重放，确认达阵（独立于解算器的验证）
 *  先重放解算器的“前向闭包推导”，让状态里出现同名 id 的事实，再重放证明本身。 */
function verify(level, steps, derivations) {
  const st = createState(level);
  for (const d of derivations || []) {
    try { applyStep(st, d); }
    catch (e) { return { ok: false, at: 0, error: '闭包推导 ' + JSON.stringify(d) + ' 失败：' + e.message }; }
  }
  for (let i = 0; i < steps.length; i++) {
    try { applyStep(st, steps[i].step); }
    catch (e) { return { ok: false, at: i + 1, error: e.message }; }
  }
  return { ok: !!matchedFact(st), at: steps.length, error: matchedFact(st) ? '' : '走完未达阵' };
}

function describe(step) {
  if (step.rule === 'assume') return '假设 ' + P(step.assume);
  if (step.rule === 'lemmaChain') return '实例化 ' + step.ids[0] + ' [' + step.terms.map((t) => t.k === 'v' ? t.name : (t.k === 'n' ? t.n : '·')).join(',') + ']';
  const extra = [
    step.term ? '项 ' + (step.term.k === 'v' ? step.term.name : step.term.k === 'n' ? step.term.n : '·') : '',
    step.pick ? step.pick : '',
    step.op ? step.op.name + (step.op.n !== undefined ? step.op.n : '') : '',
    step.formula ? P(step.formula) : '',
  ].filter(Boolean).join(' ');
  return step.rule + '(' + (step.ids || []).join(',') + (extra ? ' ' + extra : '') + ')';
}

const out = [];
let pass = 0, fail = 0;
for (const lv of targets) {
  if (!lv) continue;
  const compiled = compileLevel(lv);
  const t0 = Date.now();
  const r = findProof(compiled, { maxDepth, budget, timeMs });
  const ms = Date.now() - t0;
  if (!r.ok) {
    if (!asJson) console.log(lv.id.padEnd(7) + ' ✗ ' + r.reason + '   (' + ms + 'ms, ' + r.nodes + ' 节点)');
    out.push({ id: lv.id, ok: false, reason: r.reason, ms, nodes: r.nodes });
    fail++;
    continue;
  }
  const v = verify(lv, r.steps, r.derivations);
  if (!v.ok) {
    if (!asJson) console.log(lv.id.padEnd(7) + ' ✗ 搜到了但内核不接受：第 ' + v.at + ' 步 ' + v.error);
    out.push({ id: lv.id, ok: false, reason: 'verify: ' + v.error, ms, nodes: r.nodes });
    fail++;
    continue;
  }
  pass++;
  if (!asJson) {
    console.log(lv.id.padEnd(7) + ' ✓ ' + String(r.steps.length).padStart(2) + ' 步，' + String(ms).padStart(5) + 'ms，' + String(r.nodes).padStart(6) + ' 节点   → ' + P(compiled.goal));
    console.log('        ' + r.steps.map((s) => describe(s.step)).join('  →  '));
  }
  out.push({ id: lv.id, ok: true, steps: r.steps.map((s) => s.step), ms, nodes: r.nodes, goal: P(compiled.goal) });
}
if (asJson) console.log(JSON.stringify(out, null, 2));
else console.log('\n合计：成功 ' + pass + '，失败 ' + fail);
