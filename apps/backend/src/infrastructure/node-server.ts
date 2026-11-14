import { createServer } from 'node:http';
import { handleHttp } from '../transport/http-handler.js';

export function createNodeServer() {
  return createServer((request, response) => {
    const result = handleHttp({
      method: request.method ?? '',
      path: (request.url ?? '').split('?')[0] ?? '',
    });
    response.writeHead(result.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(result.status === 405 ? { Allow: 'GET' } : {}),
    });
    response.end(JSON.stringify(result.body));
  });
}
