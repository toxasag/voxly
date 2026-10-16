import { readFile } from 'node:fs/promises';

/** Audit tools must never accept a production database or inherited transport keys. */
export function validateAuditRuntime(runtime) {
  if (!runtime || typeof runtime !== 'object') throw new Error('Invalid audit runtime');
  const name = /^getvoxly_audit_[0-9]+$/;
  const url = new URL(runtime.databaseUrl);
  if (!name.test(runtime.database) || runtime.database !== runtime.role ||
      url.protocol !== 'postgres:' || url.hostname !== '127.0.0.1' ||
      url.port !== '5432' || url.pathname !== `/${runtime.database}` ||
      url.username !== runtime.role || !url.password || url.search || url.hash ||
      typeof runtime.jwtSecret !== 'string' || runtime.jwtSecret.length < 32) {
    throw new Error('Refusing non-audit database');
  }
  return runtime;
}

export async function loadAuditRuntime() {
  return validateAuditRuntime(JSON.parse(await readFile(
    new URL('../.audit/runtime.json', import.meta.url), 'utf8',
  )));
}

export function applyAuditEnvironment(runtime) {
  validateAuditRuntime(runtime);
  for (const key of Object.keys(process.env)) {
    if (!['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'TERM'].includes(key)) delete process.env[key];
  }
  Object.assign(process.env, {
    NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '4100',
    DATABASE_URL: runtime.databaseUrl, JWT_SECRET: runtime.jwtSecret,
    CORS_ORIGIN: 'http://localhost:3100,http://127.0.0.1:3100',
    PUBLIC_APP_URL: 'http://localhost:3100',
  });
}
