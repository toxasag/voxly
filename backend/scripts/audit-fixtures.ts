import { loadAuditRuntime, applyAuditEnvironment } from './audit-runtime.mjs';
const runtime = await loadAuditRuntime();
applyAuditEnvironment(runtime);
const { ensureTenantDefaults } = await import('../src/modules/tenant/tenant-defaults.ts');
const { withTenant, closePool } = await import('../src/db/client.ts');
const tenants = ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'];
try {
  for (const [index, tenant] of tenants.entries()) {
    await ensureTenantDefaults(tenant);
    await withTenant(tenant, async (tx) => {
      const user = await tx.queryOneOrThrow<{ id: string }>('SELECT id FROM users WHERE tenant_id=$1 AND role=$2 LIMIT 1', [tenant, 'owner']);
      const contact = await tx.queryOneOrThrow<{ id: string }>(
        `INSERT INTO contacts(id,tenant_id,first_name,last_name,email,created_by)
         VALUES ($1,$2,'Контроль','Изоляции',$3,$4)
         ON CONFLICT(id) DO UPDATE SET first_name=EXCLUDED.first_name RETURNING id`,
        [`${index === 0 ? 'aaaaaaaa-aaaa-aaaa-aaaa' : 'bbbbbbbb-bbbb-bbbb-bbbb'}-000000000001`, tenant, `isolation-${index}@audit.test`, user.id]);
      await tx.query(
        `UPDATE contacts c SET company_name=co.name FROM companies co
         WHERE c.tenant_id=$1 AND co.tenant_id=$1 AND co.id=c.company_id AND c.company_name=''`, [tenant]);
      if (index === 0) {
        await tx.query(
          `INSERT INTO repair_orders(id,tenant_id,ticket_number,customer_id,customer_name,customer_phone,
           equipment_type,equipment_brand,equipment_model,equipment_serial,defect_description,master_id,master_name)
           VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000002',$1,'AUDIT-001',$2,'Audit клиент','+79990000000',
           'Ноутбук','Audit','Test','SYNTHETIC','Не включается',$3,'Audit мастер') ON CONFLICT(id) DO NOTHING`,
          [tenant, contact.id, user.id]);
        await tx.query(
          `INSERT INTO invoices(id,tenant_id,invoice_number,company_name,subtotal,total,created_by)
           VALUES('aaaaaaaa-aaaa-aaaa-aaaa-000000000003',$1,'AUDIT-INVOICE-001','Ромашка Audit',1000,1000,$2)
           ON CONFLICT(id) DO NOTHING`, [tenant, user.id]);
      }
    });
  }
  console.log('Tenant defaults, isolation contacts, repair and invoice ensured without external calls.');
} finally { await closePool(); }
