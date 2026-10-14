// 로컬 정적 서버: 저장소 루트를 서비스하며 vercel.json의 응답 헤더(CSP 등)를 그대로 적용한다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
};

function loadHeaders() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    const entry = (cfg.headers || [])[0];
    return Object.fromEntries((entry?.headers || []).map((h) => [h.key, h.value]));
  } catch {
    return {};
  }
}

export function startServer(port = 5173) {
  const server = http.createServer((req, res) => {
    const headers = loadHeaders(); // 요청마다 읽어 vercel.json 수정이 서버 재시작 없이 반영되게 함
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || rel.startsWith('/tests/') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer(Number(process.env.PORT) || 5173).then(() => console.log('http://localhost:5173'));
}
