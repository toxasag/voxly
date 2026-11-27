import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useEffect } from "react";
import { useMarkEntityNotificationsRead } from "./use-inapp-notifications";

const postMock = vi.fn();

vi.mock("@/lib/api/apiClient", () => ({
  apiClient: {
    post: (...args: unknown[]) => postMock(...args),
  },
}));

function TestConsumer({ dealId }: { dealId: string }) {
  const { markEntityRead } = useMarkEntityNotificationsRead();

  useEffect(() => {
    markEntityRead({
      entity_type: "deal",
      entity_id: dealId,
      categories: ["lead"],
    });
  }, [dealId, markEntityRead]);

  return <div>{dealId}</div>;
}

describe("useMarkEntityNotificationsRead — защита от бесконечного цикла", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postMock.mockResolvedValue({ data: { updated: 1 } });
  });

  it("вызывает POST /api/v1/notifications/read-by-entity ровно 1 раз при использовании в useEffect", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <TestConsumer dealId="9ece85ce-d44b-4228-9a50-41918d1d94a2" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    // Даём время убедиться, что повторных вызовов из-за смены ссылки callback нет
    await new Promise((r) => setTimeout(r, 80));
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith("/api/v1/notifications/read-by-entity", {
      entity_type: "deal",
      entity_id: "9ece85ce-d44b-4228-9a50-41918d1d94a2",
      categories: ["lead"],
    });
  });

  it("не зацикливается даже при ошибке 429 от API", async () => {
    postMock.mockRejectedValue(new Error("Rate limit exceeded"));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <TestConsumer dealId="9ece85ce-d44b-4228-9a50-41918d1d94a2" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    await new Promise((r) => setTimeout(r, 80));
    expect(postMock).toHaveBeenCalledTimes(1);
  });
});
