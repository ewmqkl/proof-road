// tools/gen-proofs.mjs —— 用解算器为所有关卡生成证明，写成 src/data/found-proofs.js
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileLevel } from '../src/core/level-utils.js';
import { LEVELS } from '../src/data/levels.js';
import { findProof, verifyPlan } from '../src/core/solver.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = {};
let ok = 0, bad = 0;
for (const lv of LEVELS) {
  const compiled = compileLevel(lv);
  const t0 = Date.now();
  const r = findProof(compiled, { maxDepth: 9, budget: 30000, timeMs: 8000 });
  const ms = Date.now() - t0;
  if (r.ok && verifyPlan(compiled, r.derivations, r.steps)) {
    out[lv.id] = { steps: r.steps.map((s) => s.step), derivations: r.derivations, ms, nodes: r.nodes };
    ok++;
    console.log(lv.id.padEnd(7) + ' ✓ ' + r.steps.length + ' 步（' + ms + 'ms，' + r.nodes + ' 节点）');
  } else {
    out[lv.id] = null;
    bad++;
    console.log(lv.id.padEnd(7) + ' ✗ ' + (r.ok ? '未通过校验' : r.reason));
  }
}
const header = '// src/data/found-proofs.js —— 由 tools/gen-proofs.mjs 自动生成：解算器搜到的证明\n'
  + '// 说明：这是搜索器的产物，与 levels.js 里手写的标准证明相互独立，用于交叉验证与提示。\n'
  + '// 重新生成：node tools/gen-proofs.mjs\n\n'
  + 'export const FOUND_PROOFS = ';
await writeFile(resolve(root, 'src/data/found-proofs.js'), header + JSON.stringify(out, null, 2) + ';\n', 'utf8');
console.log('\n成功 ' + ok + ' 关，失败 ' + bad + ' 关 → src/data/found-proofs.js');
