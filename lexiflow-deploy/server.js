// Single-port static server for the App Publishing sandbox.
// The sandbox injects PORT; we listen on it (and 0.0.0.0) so the
// reverse-proxied public URL can reach the app.
var http = require('http');
var fs = require('fs');
var path = require('path');

var root = __dirname;
var port = Number(process.env.PORT || 8777);

// --- Sandbox precheck: make the tool's "auto-detect" path see a clean
//     static project.  The sandbox's own HTTP server (python -m http.server
//     $PORT) picks up the directory automatically; no install step needed.
//     When NODE_ENV=lexiflow-sandbox is set we bind to $PORT instead. ---
if (process.env.PORT && process.env.PORT !== '8777') {
  port = Number(process.env.PORT);
}

var types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

var server = http.createServer(function (req, res) {
  var urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  // Basic path-traversal guard
  var safe = path.normalize(urlPath);
  if (safe.indexOf('..') === 0 || safe.indexOf('/..') !== -1) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  var filePath = path.join(root, safe);
  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    var ext = path.extname(filePath).toLowerCase();
    var headers = {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*'
    };
    // Cache static assets aggressively (sw.js versioning handles updates)
    if (ext !== '.html' && ext !== '.webmanifest') {
      headers['Cache-Control'] = 'public, max-age=3600';
    } else {
      headers['Cache-Control'] = 'no-cache';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
});

server.listen(port, '0.0.0.0', function () {
  console.log('LexiFlow serving on 0.0.0.0:' + port);
});
