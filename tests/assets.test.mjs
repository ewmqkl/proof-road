// tests/assets.test.mjs —— 构建产物（图标）的完整性与方向
// 图标是纯代码光栅化出来的（tools/make-icon.mjs），所以它也能被测：
// 一旦有人把几何改错，这里会先报，而不是等到打开 exe 才发现图标不对。
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from './_runner.mjs';

const root = new URL('../', import.meta.url);
const iconPath = new URL('desktop/assets/app.ico', root);
const previewPath = new URL('desktop/assets/icon-preview.png', root);
const genPath = new URL('tools/make-icon.mjs', root);

test('图标生成器：∃ 的竖笔必须在右边（写到左边就变成字母 E 了）', () => {
  const src = readFileSync(genPath, 'utf8');
  const block = src.match(/const EXIST = \[([\s\S]*?)\];/);
  assert.ok(block, 'make-icon.mjs 里找不到 EXIST 几何定义');
  const rects = [...block[1].matchAll(/\[\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/g)]
    .map((m) => ({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4] }));
  assert.equal(rects.length, 4, '∃ 应当是 4 笔（一竖三横），实际 ' + rects.length);

  const widthOf = (r) => r.x1 - r.x0;
  const spine = rects.reduce((a, b) => (widthOf(b) < widthOf(a) ? b : a));
  const bars = rects.filter((r) => r !== spine);

  // ∃ 是 E 的镜像：竖笔在右半边，三横从左边一直伸到竖笔
  assert.ok(widthOf(spine) < 0.2, '竖笔应当很窄，实际宽度 ' + widthOf(spine).toFixed(3));
  assert.ok(spine.x0 > 0.55, '∃ 的竖笔应当在右半边（x0=' + spine.x0 + '）；写到左边就画成了 E');
  assert.equal(bars.length, 3, '应当有三横');
  for (const b of bars) {
    assert.ok(widthOf(b) > 0.3, '横笔应当足够长，实际 ' + widthOf(b).toFixed(3));
    assert.ok(b.x1 >= spine.x1 - 0.02, '横笔的右端应当接到竖笔上（x1=' + b.x1 + '，竖笔 x1=' + spine.x1 + '）');
    assert.ok(b.x0 < 0.35, '横笔应当从左侧起笔（x0=' + b.x0 + '）');
  }
  // 三横自上而下排列
  const ys = bars.map((b) => b.y0).sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] > ys[i - 1], '三横应当自上而下分开');
});

test('app.ico 是一个能被 Windows 读取的多尺寸图标', () => {
  assert.ok(existsSync(iconPath), '缺少 desktop/assets/app.ico，先跑 node tools/make-icon.mjs');
  const buf = readFileSync(iconPath);
  assert.equal(buf.readUInt16LE(0), 0, 'ICO 保留字段应当是 0');
  assert.equal(buf.readUInt16LE(2), 1, '类型应当是 1（图标）');
  const count = buf.readUInt16LE(4);
  assert.ok(count >= 5, '尺寸太少：' + count);

  const sizes = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    const w = buf[o] === 0 ? 256 : buf[o];
    const h = buf[o + 1] === 0 ? 256 : buf[o + 1];
    assert.equal(w, h, '第 ' + i + ' 张图不是正方形：' + w + 'x' + h);
    const bpp = buf.readUInt16LE(o + 6);
    assert.equal(bpp, 32, '第 ' + i + ' 张图应当是 32bpp，实际 ' + bpp);
    const len = buf.readUInt32LE(o + 8);
    const off = buf.readUInt32LE(o + 12);
    assert.ok(off + len <= buf.length, '第 ' + i + ' 张图的数据越界');
    // 条目必须是 DIB（不是 PNG）——System.Drawing.Icon 与老版本 Windows 对 PNG 条目支持不一
    const sig = buf.readUInt32LE(off);
    assert.equal(sig, 40, '第 ' + i + ' 张图应当是 40 字节头的 DIB，实际头 ' + sig);
    sizes.push(w);
  }
  for (const must of [16, 32, 48, 256]) {
    assert.ok(sizes.indexOf(must) >= 0, '缺少 ' + must + 'px 这一档：' + sizes.join('/'));
  }
});

test('图标预览图存在（改完图标先看它，16px 下最容易糊成一团）', () => {
  assert.ok(existsSync(previewPath), '缺少 desktop/assets/icon-preview.png');
  const png = readFileSync(previewPath);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], '不是合法的 PNG');
  assert.ok(png.length > 2000, '预览图太小，可能是空的');
});

test('桌面工程确实把图标挂上了（exe 的文件图标与窗口图标都取自它）', () => {
  const csproj = readFileSync(new URL('desktop/ProofRoad.csproj', root), 'utf8');
  assert.ok(/<ApplicationIcon>assets\\app\.ico<\/ApplicationIcon>/.test(csproj),
    'csproj 没有设置 ApplicationIcon，exe 的文件图标会是默认的');
  assert.ok(/LogicalName="ProofRoad\.Resources\.app\.ico"/.test(csproj),
    'csproj 没有把 app.ico 内嵌成资源，窗口图标会退回默认图标');
  const form = readFileSync(new URL('desktop/src/MainForm.cs', root), 'utf8');
  assert.ok(form.indexOf('ProofRoad.Resources.app.ico') >= 0, 'MainForm 没有加载内嵌图标资源');
});
