import { describe, expect, it } from "vitest";
import { buildUsageChargeKey } from "../modules/ai/ai-usage-queue.js";

describe("AiUsageQueue - buildUsageChargeKey", () => {
  it("генерирует детерминированный ключ при наличии externalId", () => {
    const key1 = buildUsageChargeKey({
      channel: "telegram",
      tenantId: "11111111-1111-1111-1111-111111111111",
      requestType: "reply",
      externalId: "msg_987654",
    });

    const key2 = buildUsageChargeKey({
      channel: "telegram",
      tenantId: "11111111-1111-1111-1111-111111111111",
      requestType: "reply",
      externalId: "msg_987654",
    });

    expect(key1).toBe("telegram:11111111-1111-1111-1111-111111111111:reply:msg_987654");
    expect(key1).toBe(key2);
  });

  it("генерирует уникальные ключи при отсутствии externalId", () => {
    const key1 = buildUsageChargeKey({
      channel: "max",
      tenantId: "22222222-2222-2222-2222-222222222222",
      requestType: "asr",
    });

    const key2 = buildUsageChargeKey({
      channel: "max",
      tenantId: "22222222-2222-2222-2222-222222222222",
      requestType: "asr",
    });

    expect(key1).not.toBe(key2);
    expect(key1.startsWith("max:22222222-2222-2222-2222-222222222222:asr:r")).toBe(true);
  });
});
