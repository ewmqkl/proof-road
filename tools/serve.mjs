// tools/serve.mjs —— 零依赖静态服务器（本地打开游戏用）
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
// 只把数字参数当端口（--status 之类的开关要忽略）
const portArg = process.argv.slice(2).find((a) => /^\d+$/.test(a));
const port = Number(portArg || 8788);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

// --status：不启动服务，只探一下 8788 是否还活着
if (process.argv.includes('--status')) {
  const { request } = await import('node:http');
  const req = request({ host: '127.0.0.1', port, path: '/index.html', timeout: 4000 }, (res) => {
    let n = 0;
    res.on('data', (c) => { n += c.length; });
    res.on('end', () => console.log('服务正常：http://127.0.0.1:' + port + '/  HTTP ' + res.statusCode + '，index.html ' + n + ' 字节'));
  });
  req.on('timeout', () => { console.log('服务无响应（超时）。重新启动：node tools/serve.mjs'); req.destroy(); });
  req.on('error', (e) => console.log('连不上 127.0.0.1:' + port + '（' + e.code + '）。重新启动：node tools/serve.mjs'));
  req.end();
} else {
createServer(async (req, res) => {
  try {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = url === '/' ? '/index.html' : url;
    const file = normalize(join(root, rel));
    if (!file.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 ' + e.message);
  }
}).listen(port, '127.0.0.1', () => {
  console.log('证明之路 已启动：http://127.0.0.1:' + port + '/');
});
}
