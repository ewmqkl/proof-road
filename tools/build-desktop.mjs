// tools/build-desktop.mjs —— 把工作区打包成 Windows 桌面应用（自包含，目标机器不需要装任何运行时）
//
// 用法：
//   node tools/build-desktop.mjs                    # 默认出 win-x86 + win-x64 两个单文件 exe
//   node tools/build-desktop.mjs --rid win-x86      # 只出一个架构
//   node tools/build-desktop.mjs --no-single-file   # 出"目录版"：不打成单文件，启动最快，也不碰 TEMP
//   node tools/build-desktop.mjs --skip-web         # 跳过重新生成网页单文件版
//   node tools/build-desktop.mjs --icon             # 先重新生成图标（改了 tools/make-icon.mjs 之后用）
//   node tools/build-desktop.mjs --zip              # 顺手打一个可以直接发给别人的 zip
//                                                   #（压缩包名带版本号，取自 csproj 的 <Version>）
//
// 产物统一落在 release/ 下。
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = join(root, 'desktop', 'ProofRoad.csproj');
const releaseDir = join(root, 'release');

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
function flag(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}
const rids = flag('--rid', 'win-x86,win-x64').split(',').map((s) => s.trim()).filter(Boolean);
const singleFile = !argv.includes('--no-single-file');
const skipWeb = argv.includes('--skip-web');
const wantZip = argv.includes('--zip');
const wantIcon = argv.includes('--icon');

/* ---------- 小工具 ---------- */
function run(command, args, label) {
  process.stdout.write('\n▶ ' + label + '\n');
  const r = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  if (r.error) throw new Error('执行 ' + command + ' 失败：' + r.error.message);
  if (r.status !== 0) throw new Error(label + ' 失败（退出码 ' + r.status + '）');
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// Windows 上刚写出来的大文件常被杀软/索引器短暂占用，copy/remove 要会重试
function retry(label, action, attempts = 12, delayMs = 400) {
  for (let i = 1; ; i++) {
    try {
      return action();
    } catch (err) {
      if (i >= attempts) throw new Error(label + ' 失败（重试 ' + attempts + ' 次后放弃）：' + err.message);
      const until = Date.now() + delayMs;
      while (Date.now() < until) { /* 忙等一小会儿 */ }
    }
  }
}

/* ---------- 纯 Node 的 zip 写入器（零依赖，够用就行） ---------- */
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

/** files: [{ name, path }]，name 是压缩包内的文件名（支持中文，走 UTF-8 标志位） */
function writeZip(zipPath, files) {
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  const parts = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8');
    const raw = readFileSync(file.path);
    const packed = deflateRawSync(raw, { level: 6 });
    const useDeflate = packed.length < raw.length;      // 已经压过的 exe 可能压不动，那就原样存
    const payload = useDeflate ? packed : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);                     // bit 11：文件名是 UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBytes, payload);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(dosTime, 12);
    entry.writeUInt16LE(dosDate, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(payload.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);

    offset += local.length + nameBytes.length + payload.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  writeFileSync(zipPath, Buffer.concat([...parts, directory, end]));
}

/** 版本号只认 csproj 里的 <Version>，别处不再写第二份 */
function projectVersion() {
  try {
    const matched = readFileSync(project, 'utf8').match(/<Version>([^<]+)<\/Version>/);
    return matched ? matched[1].trim() : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function humanSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

/* ---------- 1 · 先把网页本体重新打一遍 ---------- */
if (!skipWeb) {
  run(process.execPath, ['tools/build-single.mjs'], '把 src/ 重新打包成 proof-road-standalone.html');
  run(process.execPath, ['tools/check-standalone.mjs'], '校验单文件网页真的能跑起来');
}

/* ---------- 2 · 图标（默认只在缺失时生成，--icon 强制重画） ---------- */
if (wantIcon || !existsSync(join(root, 'desktop', 'assets', 'app.ico'))) {
  run(process.execPath, ['tools/make-icon.mjs'], '生成应用图标');
}

/* ---------- 3 · 逐个架构发布 ---------- */
mkdirSync(releaseDir, { recursive: true });
const summary = [];

for (const rid of rids) {
  const outDir = join(releaseDir, singleFile ? rid + '-single' : rid + '-folder');
  retry('清理旧目录 ' + outDir, () => rmSync(outDir, { recursive: true, force: true }));

  const args = [
    'publish', project,
    '-c', 'Release',
    '-r', rid,
    '--self-contained', 'true',
    '--nologo', '-v', 'minimal',
    '-p:DebugType=none',
    '-p:PublishReadyToRun=false',
    '-o', outDir,
  ];
  if (singleFile) {
    args.push(
      '-p:PublishSingleFile=true',
      '-p:IncludeNativeLibrariesForSelfExtract=true',   // WebView2Loader.dll 是原生 DLL，必须允许自解包
      '-p:EnableCompressionInSingleFile=true');          // 42 MB 而不是 95 MB；托管程序集在内存里解压
  }
  run('dotnet', args, '发布 ' + rid + (singleFile ? '（单文件）' : '（目录版）'));
  summary.push({ rid, outDir, size: walk(outDir, []).reduce((s, f) => s + statSync(f).size, 0) });
}

/* ---------- 4 · 组装 release/ ---------- */
const archSuffix = { 'win-x86': '', 'win-x64': '-x64', 'win-arm64': '-arm64' };
const shipped = [];

if (singleFile) {
  for (const item of summary) {
    const src = join(item.outDir, 'ProofRoad.exe');
    if (!existsSync(src)) continue;
    const suffix = Object.prototype.hasOwnProperty.call(archSuffix, item.rid)
      ? archSuffix[item.rid]
      : '-' + item.rid;
    const dst = join(releaseDir, 'ProofRoad' + suffix + '.exe');
    retry('复制 ' + dst, () => copyFileSync(src, dst));
    shipped.push(dst);
    // 单文件模式下中间目录已经没用了，清掉（清不掉也不影响结果）
    retry('清理 ' + item.outDir, () => rmSync(item.outDir, { recursive: true, force: true }), 3, 300);
  }
} else {
  for (const item of summary) {
    shipped.push(join(item.outDir, 'ProofRoad.exe'));
  }
}

const readme = join(root, 'desktop', '使用说明.txt');
if (existsSync(readme)) copyFileSync(readme, join(releaseDir, '使用说明.txt'));

/* ---------- 5 · 可选：打一个可以直接发给别人的 zip ---------- */
let zipPath = null;
if (wantZip && singleFile) {
  const version = projectVersion();
  // 版本号进了文件名，就得顺手清掉以前那份，免得 release/ 里堆一串分不清新旧
  for (const entry of readdirSync(releaseDir)) {
    if (entry.startsWith('证明之路-Windows桌面版') && entry.endsWith('.zip')) {
      retry('清理旧压缩包 ' + entry, () => rmSync(join(releaseDir, entry), { force: true }), 3, 300);
    }
  }
  zipPath = join(releaseDir, '证明之路-Windows桌面版-v' + version + '.zip');
  const contents = [join(releaseDir, 'ProofRoad.exe')];
  if (existsSync(readme)) contents.push(join(releaseDir, '使用说明.txt'));
  retry('打包 ' + zipPath, () => writeZip(zipPath, contents.map((p) => ({
    name: p.slice(p.lastIndexOf('\\') + 1),
    path: p,
  }))));
}

/* ---------- 6 · 汇报 ---------- */
console.log('\n' + '='.repeat(64));
console.log('发布完成，产物在 release/');
console.log('='.repeat(64));
for (const file of shipped) {
  console.log('  ' + file.replace(root + '\\', '').padEnd(34) + humanSize(statSync(file).size).padStart(10));
}
if (existsSync(join(releaseDir, '使用说明.txt'))) console.log('  使用说明.txt');
if (zipPath && existsSync(zipPath)) {
  console.log('  ' + zipPath.replace(root + '\\', '').padEnd(34) + humanSize(statSync(zipPath).size).padStart(10));
}
console.log('');
