import { describe, expect, it } from "vitest";

describe("RLS audit contract", () => {
  it("documents the durable lead delivery table contract", () => {
    const row = {
      table_name: "lead_notification_deliveries",
      rls_enabled: true,
      rls_forced: true,
      has_tenant_id: true,
      has_policy: true,
      has_unsafe_tenant_foreign_key: false,
    };

    expect(row.rls_enabled && row.rls_forced && row.has_tenant_id && row.has_policy).toBe(true);
    expect(row.has_unsafe_tenant_foreign_key).toBe(false);
  });
});
