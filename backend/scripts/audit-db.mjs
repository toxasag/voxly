import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Separate database/role. Never drop or reset a pre-existing database.
const root = new URL('../', import.meta.url);
const dir = new URL('.audit/', root);
const name = `getvoxly_audit_${Date.now()}`;
const password = randomBytes(24).toString('hex');
const admin = new pg.Client({ host: '127.0.0.1', port: 5432, database: 'postgres', user: process.env.USER });
await mkdir(dir, { recursive: true, mode: 0o700 });
try {
  await readFile(new URL('runtime.json', dir));
  throw new Error('Audit runtime already exists; refusing to overwrite or recreate it');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await admin.connect();
try {
  await admin.query(`CREATE ROLE "${name}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`);
  await admin.query(`CREATE DATABASE "${name}"`);
} finally { await admin.end(); }
const db = new pg.Client({ host: '127.0.0.1', port: 5432, database: name, user: process.env.USER });
await db.connect();
try {
  await db.query(await readFile(new URL('src/db/schema.sql', root), 'utf8'));
  await db.query(`GRANT CONNECT ON DATABASE "${name}" TO "${name}"`);
  await db.query(`GRANT USAGE ON SCHEMA public TO "${name}"`);
  await db.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${name}"`);
  await db.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${name}"`);
} finally { await db.end(); }
await writeFile(new URL('runtime.json', dir), JSON.stringify({
  database: name, role: name,
  databaseUrl: `postgres://${name}:${password}@127.0.0.1:5432/${name}`,
  jwtSecret: randomBytes(40).toString('hex'),
}), { mode: 0o600, flag: 'wx' });
console.log(`Created isolated audit database and role: ${name}. Runtime: ${fileURLToPath(dir)} (secrets not printed).`);
