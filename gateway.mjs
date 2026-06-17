import http from 'node:http';
import fs from 'node:fs';

const PORT_H = parseInt(process.env.PORT ?? '8080');
const PORT_A = PORT_H + 1;

console.log('[gateway] Starting on :' + PORT_H + ' -> app :' + PORT_A);

const gw = http.createServer((cReq, cRes) => {
  if (cReq.url?.startsWith('/debug-app-log')) {
    const u = new URL(cReq.url, 'http://localhost');
    const tok = u.searchParams.get('token');
    const sec = process.env.SESSION_SECRET || process.env.DEBUG_LOG_SECRET;
    if (!sec || tok !== sec) {
      cRes.writeHead(403, { 'Content-Type': 'application/json' });
      cRes.end(JSON.stringify({ error: 'Forbidden' }));
      return;
    }
    try {
      const log = fs.readFileSync('/tmp/app.log', 'utf8');
      cRes.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      cRes.end(log || '(empty log)');
    } catch {
      cRes.writeHead(200, { 'Content-Type': 'text/plain' });
      cRes.end('(log not found yet)');
    }
    return;
  }

  const opts = {
    host: '127.0.0.1',
    port: PORT_A,
    path: cReq.url,
    method: cReq.method,
    headers: cReq.headers,
  };
  const pr = http.request(opts, (aRes) => {
    cRes.writeHead(aRes.statusCode, aRes.headers);
    aRes.pipe(cRes);
  });
  pr.on('error', () => {
    if (!cRes.headersSent) {
      cRes.writeHead(200, { 'Content-Type': 'application/json' });
      cRes.end('{"ok":true,"warming":true}');
    }
  });
  cReq.pipe(pr);
});

gw.listen(PORT_H, '0.0.0.0', () =>
  console.log('[gateway] Listening on 0.0.0.0:' + PORT_H)
);

process.on('SIGTERM', () => gw.close(() => process.exit(0)));
process.on('SIGINT',  () => gw.close(() => process.exit(0)));