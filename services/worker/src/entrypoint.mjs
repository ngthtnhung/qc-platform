import { createServer } from 'node:http';
const port = Number(process.env.HEALTH_PORT ?? 4100);
createServer((request, response) => {
  response.writeHead(request.url === '/health' ? 200 : 404);
  response.end();
}).listen(port, '0.0.0.0');
