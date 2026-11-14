import { createNodeServer } from './infrastructure/node-server.js';

const port = Number(process.env['PORT'] ?? '3000');
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('PORT must be an integer between 0 and 65535');
}

const server = createNodeServer();
server.listen(port, process.env['HOST'] ?? '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address !== 'string') {
    console.info(`Helpy backend listening on port ${address.port}`);
  }
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { server.close(); });
}
