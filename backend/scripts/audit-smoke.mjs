import assert from 'node:assert/strict';
import pg from 'pg';
import { loadAuditRuntime, applyAuditEnvironment } from './audit-runtime.mjs';

const runtime = await loadAuditRuntime();
applyAuditEnvironment(runtime);
const { buildApp } = await import('../src/app.ts');
const { closePool } = await import('../src/db/client.ts');
const app = await buildApp();
await app.ready();
let assertions = 0;
async function request(token, method, url, payload, status = 200) {
  const response = await app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
  assert.equal(response.statusCode, status, `${method} ${url}: ${response.statusCode} ${response.body.slice(0,180)}`);
  assertions++;
  return response.body ? response.json().data : undefined;
}
async function login(email) {
 const result=await request(null,'POST','/auth/login',{email,password:'AuditLocal12345'});
 return result.access_token;
}
try {
 const owner=await login('owner@audit-alpha.test');
 const beta=await login('owner@audit-beta.test');
 const viewer=await login('viewer@audit-alpha.test');
 await request(null,'GET','/api/v1/crm/contacts',undefined,401);
 await request(viewer,'POST','/api/v1/crm/contacts',{first_name:'Forbidden'},403);
 await request(owner,'GET','/api/v1/admin/billing',undefined,403);
 const platform=await login('platform@audit-alpha.test');
 const balanceBefore=await request(owner,'GET','/api/v1/ai/balance');
 await request(owner,'POST','/api/v1/ai/balance/topup',{amount_rubles:500},403);
 assert.equal((await request(owner,'GET','/api/v1/ai/balance')).balanceKopecks,balanceBefore.balanceKopecks);assertions++;
 const credited=await request(platform,'POST','/api/v1/ai/balance/topup',{amount_rubles:500});
 assert.equal(credited.balanceKopecks,balanceBefore.balanceKopecks+50000);assertions++;
 const company=await request(owner,'POST','/api/v1/crm/companies',{name:'Audit API company'},201);
 const contact=await request(owner,'POST','/api/v1/crm/contacts',{first_name:'Audit API',company_id:company.id},201);
 await request(owner,'PATCH',`/api/v1/crm/contacts/${contact.id}`,{job_title:'Verified'});
 assert.equal((await request(owner,'GET',`/api/v1/crm/contacts/${contact.id}`)).jobTitle,'Verified');assertions++;
 await request(beta,'GET',`/api/v1/crm/contacts/${contact.id}`,undefined,404);
 await request(beta,'PATCH',`/api/v1/crm/contacts/${contact.id}`,{first_name:'Cross tenant'},404);
 const pipelines=await request(owner,'GET','/api/v1/crm/deals/pipelines');
 const board=await request(owner,'GET',`/api/v1/crm/deals/kanban?pipeline_id=${pipelines[0].id}`);
 const deal=await request(owner,'POST','/api/v1/crm/deals',{
  title:'Audit API deal',budget:500,currency:'RUB',contact_id:contact.id,company_id:company.id,
  pipeline_id:pipelines[0].id,stage_id:board[0].stageId,
 },201);
 await request(owner,'PATCH',`/api/v1/crm/deals/${deal.id}/stage`,{stage_id:board[1].stageId});
 assert.equal((await request(owner,'GET',`/api/v1/crm/deals/${deal.id}`)).stageId,board[1].stageId);assertions++;
 const task=await request(owner,'POST','/api/v1/crm/tasks',{
  title:'Audit API task',assignee_id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',linked_entity_type:'deal',linked_entity_id:deal.id,
 },201);
 await request(owner,'PATCH',`/api/v1/crm/tasks/${task.id}`,{status:'done'});
 const note=await request(owner,'POST','/api/v1/crm/notes',{body:'Audit persisted note',target_type:'contact',target_id:contact.id},201);
 await request(owner,'DELETE',`/api/v1/crm/notes/${note.id}`,undefined,204);
 await request(owner,'DELETE',`/api/v1/crm/tasks/${task.id}`,undefined,204);
 await request(owner,'DELETE',`/api/v1/crm/contacts/${contact.id}`,undefined,200);
 await request(owner,'GET',`/api/v1/crm/contacts/${contact.id}`,undefined,404);
 await request(owner,'DELETE',`/api/v1/crm/companies/${company.id}`,undefined,200);
 // Direct RLS evidence uses the application role, never the seeding administrator.
 const db=new pg.Client({connectionString:runtime.databaseUrl});await db.connect();
 try {
  await db.query('BEGIN');
  const none=await db.query('SELECT id FROM contacts');assert.equal(none.rowCount,0);assertions++;
  await db.query("SELECT set_config('app.tenant_id',$1,true)",['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']);
  const other=await db.query('SELECT id FROM contacts WHERE tenant_id=$1',['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']);
  assert.equal(other.rowCount,0);assertions++;
  const alphaInvoices=await db.query('SELECT id FROM invoices');
  assert.equal(alphaInvoices.rowCount,1);assertions++;
  const alphaItems=await db.query('SELECT invoice_id FROM invoice_items');
  assert.equal(alphaItems.rowCount,1);assertions++;
  const alphaDeliveries=await db.query('SELECT deal_id,status FROM lead_notification_deliveries');
  assert.equal(alphaDeliveries.rowCount,1);assert.equal(alphaDeliveries.rows[0].status,'failed');assertions+=2;
  await assert.rejects(()=>db.query("INSERT INTO contacts(tenant_id,first_name) VALUES($1,'forbidden')",['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']),{code:'42501'});assertions++;
  await db.query('ROLLBACK');
  await db.query('BEGIN');
  await db.query("SELECT set_config('app.tenant_id',$1,true)",['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']);
  const betaInvoices=await db.query('SELECT id FROM invoices');
  assert.equal(betaInvoices.rowCount,1);assertions++;
  const betaItems=await db.query('SELECT invoice_id FROM invoice_items');
  assert.equal(betaItems.rowCount,1);assertions++;
  const betaDeliveries=await db.query('SELECT deal_id FROM lead_notification_deliveries');
  assert.equal(betaDeliveries.rowCount,1);assertions++;
  await db.query('ROLLBACK');
 } finally {await db.end();}
 console.log(JSON.stringify({auditDatabase:runtime.database, assertions, result:'passed', externalProviders:false}));
} finally {await app.close();await closePool();}
