// 零依赖 Web 服务：在 Termux / 任意 Node 环境跑起部署网页。
//   GET  /            静态表单页
//   POST /api/deploy  流式返回部署进度（NDJSON 行）
// 仅用 Node 内置模块，无需 npm install。

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDeploy } from '../lib/deploy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3456;
const WORKER_SOURCE = path.join(ROOT_DIR, 'worker.fixed.js');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);
  // 防目录穿越
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Error');
  }
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function handleDeploy(req, res) {
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const writeLine = (obj) => res.write(`${JSON.stringify(obj)}\n`);

  readBody(req)
    .then(async (raw) => {
      const body = JSON.parse(raw || '{}');
      const input = {
        accountId: body.accountId,
        token: body.token,
        dashboardCookie: body.dashboardCookie,
        dashboardAtok: body.dashboardAtok,
        dashboardVses2: body.vses2,
        zoneName: body.zone,
        hostname: body.hostname,
        workerName: body.workerName,
        uuid: body.uuid,
        workerSource: WORKER_SOURCE,
        skipTest: body.skipTest !== false, // Web 默认跳过测速（Termux 无 mihomo）
        assumeNsReady: body.assumeNsReady !== false, // Web 无 TTY，默认跳过 NS 确认
      };
      const result = await runDeploy(input, (step, msg) => writeLine({ step, msg }));
      writeLine({ done: true, result });
    })
    .catch((error) => {
      writeLine({ error: error.message || String(error) });
    })
    .finally(() => res.end());
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/deploy') {
    handleDeploy(req, res);
    return;
  }
  if (req.method === 'GET') {
    serveStatic(req, res, req.url || '/');
    return;
  }
  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Method Not Allowed');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`部署网页已启动： http://0.0.0.0:${PORT}`);
  console.log(`Worker 源文件：${WORKER_SOURCE}`);
});
