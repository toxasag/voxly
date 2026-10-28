import { describe, expect, it } from "vitest";

interface ErrorEnvelope {
  status: "error";
  requestId: string;
  error: { code: string };
}

describe("error correlation contract", () => {
  it("requires requestId in error envelopes", () => {
    const payload: ErrorEnvelope = {
      status: "error",
      requestId: "req-test",
      error: { code: "VALIDATION_ERROR" },
    };
    expect(payload.requestId).toBe("req-test");
  });
});
