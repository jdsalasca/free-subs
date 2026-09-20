/**
 * Server entry point: wires the job store to the HTTP app and listens.
 */
import { createServer } from 'node:http';
import { createApp } from './app';
import { JobStore } from './jobs';
import { attachLiveWebSocket } from '../live/server';

const store = new JobStore();
const app = createApp(store);
const port = Number(process.env.PORT ?? 8787);

const server = createServer(app);
attachLiveWebSocket(server);

server.listen(port, () => {
  console.log(`Free Subs running at http://localhost:${port}`);
});

function shutdown(): void {
  console.log('\nShutting down Free Subs...');
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
