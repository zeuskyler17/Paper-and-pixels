// Tiny HTTPS front door for the shop Wi-Fi: terminates TLS on :3443 and forwards everything
// (including the dev server's live-reload websocket) to the app on http://127.0.0.1:3000.
// Node only — no packages. Certificates come from scripts/make-cert.sh.
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const certs = path.join(root, 'certs');
const PORT = Number(process.env.HTTPS_PORT || 3443);
const TARGET = { host: '127.0.0.1', port: Number(process.env.APP_PORT || 3000) };

const server = https.createServer({ key: fs.readFileSync(path.join(certs, 'server.key')), cert: fs.readFileSync(path.join(certs, 'server.crt')) }, (req, res) => {
  const headers = { ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-host': req.headers.host ?? '', 'x-forwarded-for': req.socket.remoteAddress ?? '' };
  const up = http.request({ ...TARGET, method: req.method, path: req.url, headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); res.end('The app is not running (port 3000).'); });
  req.pipe(up);
});

// Websockets (Next.js hot reload): open a plain TCP tunnel to the app.
server.on('upgrade', (req, socket, head) => {
  const up = net.connect(TARGET, () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (const [k, v] of Object.entries(req.headers)) lines.push(`${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head.length) up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

server.listen(PORT, '0.0.0.0', () => console.log(`HTTPS proxy on :${PORT} → http://${TARGET.host}:${TARGET.port}`));
