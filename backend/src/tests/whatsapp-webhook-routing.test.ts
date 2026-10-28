import { beforeAll, describe, expect, it } from "vitest";

let buildApp: typeof import("../app.js").buildApp;

beforeAll(async () => {
  process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
  process.env.JWT_SECRET = "whatsapp-routing-test-secret-0123456789";
  ({ buildApp } = await import("../app.js"));
});

describe("WhatsApp webhook routing", () => {
  it("keeps only the canonical Evolution endpoint", async () => {
    const app = await buildApp();
    await app.ready();
    try {
      const canonical = await app.inject({
        method: "POST",
        url: "/api/internal/whatsapp/webhook",
        payload: { event: "messages.upsert", instance: "unknown" },
        headers: { "x-evolution-webhook-secret": "invalid" },
      });
      expect(canonical.statusCode).not.toBe(404);

      const legacy = await app.inject({
        method: "POST",
        url: "/api/v1/integrations/whatsapp/webhook",
        payload: { event: "messages.upsert", instance: "unknown" },
        headers: { "x-evolution-webhook-secret": "invalid" },
      });
      expect(legacy.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
