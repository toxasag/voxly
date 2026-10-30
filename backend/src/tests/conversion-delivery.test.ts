import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

function eventKey(input: { tenantId: string; dealId: string; provider: string; stageId: string; eventName: string }): string {
  return createHash("sha256")
    .update(`${input.tenantId}:${input.dealId}:${input.provider}:${input.stageId}:${input.eventName}`)
    .digest("hex");
}

describe("conversion delivery idempotency", () => {
  it("generates the same key for retries and different keys for providers", () => {
    const base = { tenantId: "tenant-a", dealId: "deal-1", stageId: "stage-won", eventName: "Purchase" };
    expect(eventKey({ ...base, provider: "ga4" })).toBe(eventKey({ ...base, provider: "ga4" }));
    expect(eventKey({ ...base, provider: "meta" })).not.toBe(eventKey({ ...base, provider: "ga4" }));
  });
});
