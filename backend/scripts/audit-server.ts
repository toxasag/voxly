import { loadAuditRuntime, applyAuditEnvironment } from './audit-runtime.mjs';

const runtime = await loadAuditRuntime();
applyAuditEnvironment(runtime);
// buildApp, NOT server.ts: no webhook registration, account transport or maintenance.
const { buildApp } = await import('../src/app.ts');
const { closePool } = await import('../src/db/client.ts');
const app = await buildApp();
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await app.close(); await closePool(); process.exit(0); });
}
await app.listen({ host: '127.0.0.1', port: 4100 });
