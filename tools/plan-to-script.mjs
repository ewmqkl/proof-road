// tools/plan-to-script.mjs —— 把解算器搜到的证明变成可直接写进 levels.js 的脚本
// 用法：node tools/plan-to-script.mjs L0-15 L1-15 ...
import { compileLevel } from '../src/core/level-utils.js';
import { LEVELS } from '../src/data/levels.js';
import { findProof } from '../src/core/solver.js';
import { createState, applyStep, matchedFact } from '../src/core/proof.js';
import { P, fstr, termStr } from '../src/core/logic.js';

const ids = process.argv.slice(2);
if (!ids.length) { console.log('用法：node tools/plan-to-script.mjs <关卡id> …'); process.exit(1); }
for (const id of ids) {
  const lv = LEVELS.find((l) => l.id === id);
  if (!lv) { console.log('未知关卡 ' + id); continue; }
  const compiled = compileLevel(lv);
  const r = findProof(compiled, { maxDepth: 9, budget: 30000, timeMs: 8000 });
  console.log('/* ===== ' + id + ' 目标: ' + P(compiled.goal) + ' ===== */');
  if (!r.ok) { console.log('   /* 没搜到：' + r.reason + ' */'); continue; }
  const st = createState(lv);
  const out = [];
  for (const s of r.steps) {
    const step = s.step;
    const f = applyStep(st, step);
    const line = { rule: step.rule };
    if (step.ids && step.ids.length) line.ids = step.ids;
    if (step.assume) line.assume = fstr(step.assume);
    if (step.terms || step.term) line.terms = (step.terms || [step.term]).map((t) => termStr(t, []));
    if (step.pick) line.pick = step.pick;
    if (step.op) line.op = step.op;
    if (step.formula) line.formula = fstr(step.formula);
    line.id = f.id;
    out.push('      ' + JSON.stringify(line).replace(/"([a-z]+)":/g, '$1: ').replace(/"/g, "'") + ',');
  }
  console.log('    script: [');
  out.forEach((l) => console.log(l));
  console.log('    ],');
  console.log('    /* 达阵: ' + (!!matchedFact(st)) + ' */');
}
