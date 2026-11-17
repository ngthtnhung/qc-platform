import { createServer } from 'node:http';
const port = Number(process.env.PORT ?? 4000);
createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"status":"ok"}');
    return;
  }
  response.writeHead(501, { 'content-type': 'application/json' });
  response.end('{"error":"not_implemented"}');
}).listen(port, '0.0.0.0');
