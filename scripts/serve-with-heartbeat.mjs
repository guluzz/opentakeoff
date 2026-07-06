import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 5175;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const CHECK_INTERVAL_MS = 2_000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'web', 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
};

const HEARTBEAT_SCRIPT = `
<script>
(function () {
  var ping = function () {
    try { navigator.sendBeacon('/__hb'); } catch (e) {}
  };
  ping();
  setInterval(ping, 3000);
})();
</script>
</body>`;

let lastHeartbeat = Date.now();

const server = http.createServer((req, res) => {
  if (req.url === '/__hb') {
    lastHeartbeat = Date.now();
    res.writeHead(204);
    res.end();
    return;
  }

  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';
  let filePath = path.join(distDir, reqPath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA-style fallback to index.html for unknown routes
      filePath = path.join(distDir, 'index.html');
      fs.readFile(filePath, (err2, data2) => {
        if (err2) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        serveIndex(res, data2);
      });
      return;
    }
    const ext = path.extname(filePath);
    if (ext === '.html') {
      serveIndex(res, data);
    } else {
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    }
  });
});

function serveIndex(res, data) {
  const html = data.toString('utf-8').replace('</body>', HEARTBEAT_SCRIPT);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

server.listen(PORT, () => {
  console.log(`OpenTakeoff serving on http://localhost:${PORT}`);
});

setInterval(() => {
  if (Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
    console.log('No browser tab detected, shutting down.');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000);
  }
}, CHECK_INTERVAL_MS);
