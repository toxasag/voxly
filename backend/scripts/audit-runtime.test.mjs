import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAuditRuntime, applyAuditEnvironment } from './audit-runtime.mjs';
const valid = { database:'getvoxly_audit_123', role:'getvoxly_audit_123', databaseUrl:'postgres://getvoxly_audit_123:temporary@127.0.0.1:5432/getvoxly_audit_123', jwtSecret:'x'.repeat(40) };
test('accepts exact isolated runtime', () => assert.equal(validateAuditRuntime(valid), valid));
for (const [name, patch] of Object.entries({
  productionName:{database:'getvoxly'}, remote:{databaseUrl:valid.databaseUrl.replace('127.0.0.1','production.example')},
  queryOverride:{databaseUrl:valid.databaseUrl+'?host=production.example'}, role:{role:'app_user'},
  otherDatabase:{databaseUrl:valid.databaseUrl.replace('/getvoxly_audit_123','/getvoxly')},
  weakJwt:{jwtSecret:'short'}, missingPassword:{databaseUrl:valid.databaseUrl.replace(':temporary','')},
})) test(`rejects ${name}`, () => assert.throws(()=>validateAuditRuntime({...valid,...patch})));
test('drops provider credentials before app import', () => {
 const original={...process.env};
 try {
  Object.assign(process.env,{LLM_API_KEY:'test',MAX_BOT_TOKEN:'test',SMTP_HOST:'test',NODE_OPTIONS:'test',DATABASE_URL:'production'});
  applyAuditEnvironment(valid);
  for(const k of ['LLM_API_KEY','MAX_BOT_TOKEN','SMTP_HOST','NODE_OPTIONS']) assert.equal(process.env[k],undefined);
  assert.equal(process.env.DATABASE_URL,valid.databaseUrl);
 } finally { for(const key of Object.keys(process.env)) delete process.env[key];Object.assign(process.env,original); }
});
