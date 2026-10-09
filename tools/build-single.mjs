// tools/build-single.mjs —— 把整个游戏打包成一个自包含 HTML（双击即可玩，不需要服务器）
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 注册键 = 从项目根算起的路径，与源码里的相对导入解析结果一致
const MODULES = [
  'src/core/logic.js',
  'src/core/rules.js',
  'src/core/level-utils.js',
  'src/core/proof.js',
  'src/core/achievements.js',
  'src/core/savefile.js',
  'src/data/axioms.js',
  'src/data/levels.js',
  'src/data/found-proofs.js',
  'src/data/math-history.js',
  'src/data/achievements.js',
  'src/data/tutorial.js',
  'src/ui/candidates.js',
  'src/ui/profile.js',
  'src/ui/tutorial.js',
  'src/ui/app.js',
];

// 把相对导入改写为注册表调用：import ... from './x.js' → reg['...']
function rewriteImportPath(spec, selfDir) {
  const parts = (selfDir ? selfDir.split('/') : []).concat(spec.split('/'));
  const stack = [];
  for (const p of parts) {
    if (p === '.' || p === '') continue;
    if (p === '..') stack.pop();
    else stack.push(p);
  }
  return stack.join('/');
}

function transform(code, selfDir) {
  let out = code;
  // import { a, b as c } from './x.js';  |  import * as ns from './x.js';
  out = out.replace(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+'([^']+)';/g, (m, ns, spec) =>
    'const ' + ns + ' = reg[' + JSON.stringify(rewriteImportPath(spec, selfDir)) + '];');
  out = out.replace(/import\s*\{([^}]*)\}\s*from\s*'([^']+)';/g, (m, names, spec) => {
    const list = names.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const mm = s.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      return mm ? mm[1] + ': ' + mm[2] : s;
    });
    const key = JSON.stringify(rewriteImportPath(spec, selfDir));
    return 'const {' + list.join(', ') + '} = reg[' + key + '];';
  });
  // export { a, b };
  out = out.replace(/export\s*\{([^}]*)\};?/g, (m, names) => {
    const list = names.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const mm = s.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      return mm ? JSON.stringify(mm[2]) + ': ' + mm[1] : JSON.stringify(s) + ': ' + s;
    });
    return 'Object.assign(m, {' + list.join(', ') + '});';
  });
  // export const/let/function/class NAME
  out = out.replace(/^export\s+(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm, '$1 $2');
  // 收集被导出的顶层名字，写进模块对象
  const names = new Set();
  const reDecl = /^(?:const|let|var|function|class|async function)\s+([A-Za-z_$][\w$]*)/gm;
  let mm;
  while ((mm = reDecl.exec(out))) names.add(mm[1]);
  const exported = collectExports(code);
  const assign = [...names].filter((n) => exported.has(n) || true).map((n) => JSON.stringify(n) + ': ' + n);
  out = 'm = {};\n' + out + '\nObject.assign(m, {' + assign.join(', ') + '});\nreturn m;';
  return out;
}

function collectExports(code) {
  const set = new Set();
  for (const m of code.matchAll(/export\s+(?:const|let|var|function|class|async function)\s+([A-Za-z_$][\w$]*)/g)) set.add(m[1]);
  for (const m of code.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const mm = t.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      set.add(mm ? mm[2] : t);
    }
  }
  return set;
}

// 先读源码，解析出每个模块依赖了哪些模块
const sources = new Map();
const deps = new Map();
for (const file of MODULES) {
  const code = await readFile(resolve(root, file), 'utf8');
  sources.set(file, code);
  const selfDir = file.split('/').slice(0, -1).join('/');
  const set = new Set();
  for (const m of code.matchAll(/from\s+'([^']+)'/g)) set.add(rewriteImportPath(m[1], selfDir));
  deps.set(file, [...set]);
}
// 拓扑排序：被依赖的模块先求值（否则模块级解构会拿到 undefined）
const order = [];
const done = new Set();
let guard = 0;
while (order.length < MODULES.length && guard++ < 200) {
  for (const file of MODULES) {
    if (done.has(file)) continue;
    if (deps.get(file).every((d) => done.has(d))) { order.push(file); done.add(file); }
  }
}
if (order.length !== MODULES.length) throw new Error('模块依赖存在环或缺失：' + MODULES.filter((f) => !done.has(f)).join(', '));

let bundle = 'const reg = {};\n';
for (const file of order) {
  const selfDir = file.split('/').slice(0, -1).join('/');
  const transformed = transform(sources.get(file), selfDir);
  bundle += 'reg[' + JSON.stringify(file) + '] = (function () {\n  let m;\n' + transformed + '\n})();\n';
}
console.error('模块求值顺序: ' + order.join(' → '));

const html = await readFile(resolve(root, 'index.html'), 'utf8');
const css = await readFile(resolve(root, 'styles.css'), 'utf8');
let finalHtml = html
  .replace('<link rel="stylesheet" href="styles.css">', '<style>\n' + css + '\n</style>')
  .replace('<script type="module" src="src/ui/app.js"></script>', '<script type="module">\n' + bundle + '\n</script>');

// 暴露一个调试句柄：既方便自动化检查，也方便你在控制台里试 API
finalHtml = finalHtml.replace('</script>', 'globalThis.__lpg = reg["src/ui/app.js"];\n</script>');
await writeFile(resolve(root, 'proof-road-standalone.html'), finalHtml, 'utf8');
// 注意要报**文件的字节数**：finalHtml.length 是 UTF-16 码元数，
// 这个文件里满是中文，两者差了十几万，早先的日志就报错过。
const bytes = Buffer.byteLength(finalHtml, 'utf8');
console.log('已生成 proof-road-standalone.html，' + bytes + ' 字节（' + (bytes / 1024).toFixed(1) +
  ' KB），含 ' + MODULES.length + ' 个模块');
