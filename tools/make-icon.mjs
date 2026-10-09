// tools/make-icon.mjs —— 生成桌面版图标（纯 Node，零依赖：自己光栅化 + 自己写 PNG / ICO）
//
// 图形：ak-ui 设计令牌里的深色画布 + 蓝色的“∃”（存在量词）。
// 输出：desktop/assets/app.ico（16/24/32/48/64/128/256，全部为 32bpp DIB 条目，
//       不使用 PNG 压缩条目，以确保 System.Drawing.Icon 与所有 Windows 版本都能读取）
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'desktop/assets');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

// ak-ui 调色板
const BG_TOP = [0x1c, 0x21, 0x28];
const BG_BOTTOM = [0x0b, 0x0e, 0x12];
const BLUE = [0x4a, 0xab, 0xea];   // --ak-color-primary #4aabea

// 单位坐标（0..1，原点左上）下的几何
const CORNER = 0.17;

// 存在量词 ∃ = 右边一竖 + 上中下三横（横笔向左伸）。
// 注意方向：∃ 是 E 的镜像，**竖笔在右**（x 0.650..0.745），三横从 0.255 一直伸到 0.745。
// 竖笔写到左边就变成了普通的字母 E —— 这里踩过一次，所以把坐标和注释写死在一起。
// 整组图形的范围是 x 0.255..0.745、y 0.215..0.785，横竖都正好在方形里视觉居中；
// 三横等长，笔画粗细统一 0.095。
const EXIST = [
  [0.650, 0.2150, 0.745, 0.7850],   // 竖笔（在右）
  [0.255, 0.2150, 0.745, 0.3100],   // 上横
  [0.255, 0.4525, 0.745, 0.5475],   // 中横
  [0.255, 0.6900, 0.745, 0.7850],   // 下横
];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function sdRoundRect(px, py, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const hw = Math.max((x1 - x0) / 2 - r, 1e-6), hh = Math.max((y1 - y0) / 2 - r, 1e-6);
  const qx = Math.abs(px - cx) - hw, qy = Math.abs(py - cy) - hh;
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdRect(px, py, [x0, y0, x1, y1]) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const hw = (x1 - x0) / 2, hh = (y1 - y0) / 2;
  const qx = Math.abs(px - cx) - hw, qy = Math.abs(py - cy) - hh;
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0);
}

// 直通道 alpha 的 source-over
function over(dst, r, g, b, a) {
  if (a <= 0) return;
  const na = a + dst[3] * (1 - a);
  if (na <= 0) { dst[0] = dst[1] = dst[2] = dst[3] = 0; return; }
  dst[0] = (r * a + dst[0] * dst[3] * (1 - a)) / na;
  dst[1] = (g * a + dst[1] * dst[3] * (1 - a)) / na;
  dst[2] = (b * a + dst[2] * dst[3] * (1 - a)) / na;
  dst[3] = na;
}

/** 渲染一个尺寸，返回 RGBA Buffer */
function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  // 小尺寸把笔画加粗一点：∃ 有 4 笔，16px 下每笔只有 1.5px，不补会糊成一片
  const grow = size <= 24 ? 0.016 : size <= 48 ? 0.007 : 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ux = (x + 0.5) / size, uy = (y + 0.5) / size;
      const px = [0, 0, 0, 0];

      // ① 背景圆角方块 + 垂直渐变
      const covBg = clamp01(0.5 - sdRoundRect(ux, uy, 0, 0, 1, 1, CORNER) * size);
      if (covBg > 0) {
        const t = clamp01(uy);
        over(px,
          BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t,
          BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t,
          BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t,
          covBg);
      }


      // ② 存在符号 ∃：四笔同色，取最近的一笔算覆盖率（也就是取并集）
      let nearest = Infinity;
      for (const bar of EXIST) {
        nearest = Math.min(nearest, sdRect(ux, uy,
          [bar[0] - grow, bar[1] - grow, bar[2] + grow, bar[3] + grow]));
      }
      over(px, BLUE[0], BLUE[1], BLUE[2], clamp01(0.5 - nearest * size));

      const o = (y * size + x) * 4;
      buf[o] = Math.round(clamp01(px[0] / 255) * 255);
      buf[o + 1] = Math.round(clamp01(px[1] / 255) * 255);
      buf[o + 2] = Math.round(clamp01(px[2] / 255) * 255);
      buf[o + 3] = Math.round(clamp01(px[3]) * 255);
    }
  }
  return buf;
}

/* ---------- PNG ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(rgba, width, height = width) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- ICO（全部用 32bpp DIB 条目） ---------- */
function dib(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);   // XOR 位图 + AND 掩码
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);        // BI_RGB
  const maskRow = Math.ceil(size / 32) * 4;
  header.writeUInt32LE(size * size * 4 + maskRow * size, 20);

  const xor = Buffer.alloc(size * size * 4);
  const and = Buffer.alloc(maskRow * size, 0);
  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y;        // DIB 自下而上
    for (let x = 0; x < size; x++) {
      const i = (srcY * size + x) * 4, o = (y * size + x) * 4;
      xor[o] = rgba[i + 2]; xor[o + 1] = rgba[i + 1]; xor[o + 2] = rgba[i]; xor[o + 3] = rgba[i + 3];
      if (rgba[i + 3] < 128) and[y * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, xor, and]);
}

function buildIco(entries) {
  const dir = Buffer.alloc(6 + entries.length * 16);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(entries.length, 4);
  let offset = dir.length;
  entries.forEach((e, i) => {
    const o = 6 + i * 16;
    const dim = e.size >= 256 ? 0 : e.size;
    dir.writeUInt8(dim, o); dir.writeUInt8(dim, o + 1);
    dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.data.length;
  });
  return Buffer.concat([dir, ...entries.map((e) => e.data)]);
}

/* ---------- 预览图：把小尺寸按最近邻放大摆成一行 ---------- */
function blit(canvas, canvasWidth, src, srcSize, dx, dy, zoom) {
  for (let y = 0; y < srcSize; y++) {
    for (let x = 0; x < srcSize; x++) {
      const s = (y * srcSize + x) * 4;
      const a = src[s + 3] / 255;
      for (let zy = 0; zy < zoom; zy++) {
        for (let zx = 0; zx < zoom; zx++) {
          const cx = dx + x * zoom + zx, cy = dy + y * zoom + zy;
          if (cx < 0 || cy < 0 || cx >= canvasWidth) continue;
          const d = (cy * canvasWidth + cx) * 4;
          canvas[d] = Math.round(src[s] * a + canvas[d] * (1 - a));
          canvas[d + 1] = Math.round(src[s + 1] * a + canvas[d + 1] * (1 - a));
          canvas[d + 2] = Math.round(src[s + 2] * a + canvas[d + 2] * (1 - a));
          canvas[d + 3] = 255;
        }
      }
    }
  }
}

/**
 * 尺寸梯预览：16/24/32/48/64 放大 8 倍排成一行（格子宽 512，所以小的看起来更"糊"，
 * 但那正是它在任务栏上的真实样子），右侧再放一张 256 的原图。
 * 改完图标先看这张图——4 笔的 ∃ 最容易在 16px 下粘成一坨。
 */
function buildPreview() {
  const ladder = [16, 24, 32, 48, 64];
  const zoom = 8, gap = 14, pad = 16, cell = 64 * zoom;
  const width = pad * 2 + ladder.length * cell + ladder.length * gap + 256;
  const height = pad * 2 + cell;
  const canvas = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {          // 深色底，模拟深色任务栏
    canvas[i * 4] = 0x1a; canvas[i * 4 + 1] = 0x1d; canvas[i * 4 + 2] = 0x22; canvas[i * 4 + 3] = 0xff;
  }
  let x = pad;
  for (const size of ladder) {
    blit(canvas, width, render(size), size, x, pad + Math.round((cell - size * zoom) / 2), zoom);
    x += cell + gap;
  }
  blit(canvas, width, render(256), 256, x + gap, pad, 1);
  return encodePng(canvas, width, height);
}

/* ---------- 主流程 ---------- */
await mkdir(outDir, { recursive: true });
const entries = SIZES.map((size) => ({ size, data: dib(render(size), size) }));
const icoPath = resolve(outDir, 'app.ico');
const nextIco = buildIco(entries);

// 谢天谢地：如果现有的 app.ico 和这次要生成的不一样，先备份一份再覆盖。
// 这个文件平时是生成物，但它也可能被手工换成过别的图标——
// “跑了一次构建，我的图标变回去了” 就是这么发生的。
try {
  const prev = await readFile(icoPath);
  if (!prev.equals(nextIco)) {
    await writeFile(icoPath + '.bak', prev);
    console.log('注意：原有 app.ico 与本次生成的不同，已备份为 desktop/assets/app.ico.bak（确认无误后可自行删除）');
  }
} catch (e) { /* 文件还不存在，属于首次生成 */ }

await writeFile(icoPath, nextIco);
await writeFile(resolve(outDir, 'icon-preview.png'), buildPreview());

const kb = (entries.reduce((s, e) => s + e.data.length, 0) + 6 + entries.length * 16) / 1024;
console.log('已生成 desktop/assets/app.ico（' + SIZES.join('/') + '，' + kb.toFixed(1) + ' KB）');
