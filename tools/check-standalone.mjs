// tools/check-standalone.mjs —— 在 Node 里跑单文件版的脚本，确认它真的能启动并推完一关
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(resolve(root, 'proof-road-standalone.html'), 'utf8');
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) { console.log('✗ 找不到内联模块脚本'); process.exit(1); }
const code = m[1];

/* 最小 DOM 打桩 */
function el() {
  return {
    tagName: 'div', children: [], _html: '', textContent: '', className: '', hidden: false, value: '', title: '', style: {},
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); this.children = []; },
    appendChild(c) { this.children.push(c); return c; }, addEventListener() {},
    set onclick(f) { this._onclick = f; }, get onclick() { return this._onclick; },
  };
}
const reg = new Map();
globalThis.document = { createElement: () => el(), getElementById: (id) => { if (!reg.has(id)) reg.set(id, el()); return reg.get(id); } };
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

// 沙箱里 data: URL 不可用，先把内联脚本落到临时文件再导入
const { writeFile, mkdtemp } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const dir = await mkdtemp(join(tmpdir(), 'lpg-'));
const modFile = join(dir, 'bundle.mjs');
await writeFile(modFile, code, 'utf8');
await import('file://' + modFile.replace(/\\/g, '/'));
const mod = globalThis.__lpg;
const flush = () => new Promise((r) => setTimeout(r, 0));
await flush();

const { LEVELS } = await import('../src/data/levels.js');

/* 1) 启动状态 */
console.log('关卡总数:', LEVELS.length);
console.log('当前关卡:', mod.debugLevelId());
console.log('目标文本:', mod.debugGoalText());

/* 2) 推完 L0-04 */
mod.loadLevel('L0-04');
const st = mod.debugState();
mod.debugSelect([st.facts[0].id]);
mod.debugUseRule('andE');
console.log('L0-04 达成:', mod.debugSolved(), '| 状态栏:', mod.debugStatusText());
console.log('进度已存:', localStorage.getItem('lpg.done'));

/* 3) 逐关载入不报错 */
let bad = 0;
for (const lv of LEVELS) {
  try { mod.loadLevel(lv.id); if (!mod.debugGoalText()) bad++; } catch (e) { bad++; console.log('  ✗', lv.id, e.message); }
}
console.log('全部关卡载入后异常数:', bad);
console.log(bad === 0 && mod.debugState() ? '✓ 单文件版可用' : '✗ 单文件版有问题');
