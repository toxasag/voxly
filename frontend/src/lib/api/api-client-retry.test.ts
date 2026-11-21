import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient, ApiClientError } from "@/lib/api/apiClient";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("apiClient: повтор только для безопасных методов", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("GET повторяется один раз после 503", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(503, { error: { code: "X", message: "down" } }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { ok: true } }));

    const promise = apiClient.get<{ ok: boolean }>("/api/v1/ping");
    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toEqual({ data: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("POST не повторяется после 503 (иначе дубль мутации)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { error: { code: "X", message: "down" } }));

    const promise = apiClient.post("/api/v1/deals", { title: "t" });
    const assertion = expect(promise).rejects.toBeInstanceOf(ApiClientError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("POST не повторяется после сетевой ошибки", async () => {
    fetchMock.mockRejectedValue(new TypeError("network"));

    const promise = apiClient.post("/api/v1/deals", { title: "t" });
    const assertion = expect(promise).rejects.toBeInstanceOf(ApiClientError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
