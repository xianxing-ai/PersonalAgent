import http from 'node:http';
import {readFile} from 'node:fs/promises';

// Serve only the bundled page on loopback; no dependencies, model calls or account connections.
const page = await readFile(new URL('./index.html', import.meta.url));
const configured = process.env.PORT;
const preferredPort = configured === undefined ? 4173 : Number(configured);
if (!Number.isInteger(preferredPort) || preferredPort < 0 || preferredPort > 65535) {
  throw new Error('PORT must be an integer between 0 and 65535.');
}
const server = http.createServer((request, response) => {
  let route;
  try {
    route = new URL(request.url || '/', 'http://127.0.0.1').pathname;
  } catch {
    response.writeHead(400);
    response.end('Bad request');
    return;
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, {'Allow': 'GET, HEAD'});
    response.end('Method not allowed');
    return;
  }
  if (!['/', '/index.html', '/architecture.html'].includes(route)) {
    response.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
    response.end('Not found');
    return;
  }
  response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Content-Length': page.length, 'Cache-Control': 'no-store'});
  response.end(request.method === 'HEAD' ? undefined : page);
});
let switched = false;
server.on('error', error => {
  if (error.code === 'EADDRINUSE' && !switched && preferredPort !== 0) {
    switched = true;
    console.log('Preferred port is occupied. Selecting an available loopback port.');
    server.listen(0, '127.0.0.1');
  } else {
    console.error(error.message);
    process.exitCode = 1;
  }
});
server.on('listening', () => {
  console.log('PersonalAgent architecture: http://127.0.0.1:' + server.address().port + '/architecture.html');
  console.log('Open the URL above. Ctrl+C stops the server. No npm install is required.');
});
process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
server.listen(preferredPort, '127.0.0.1');
