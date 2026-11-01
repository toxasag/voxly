import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useRecordTimeline, type TimelineEventDTO } from "@/lib/api/use-timeline";

const getMock = vi.fn();

vi.mock("@/lib/api/apiClient", () => ({
  apiClient: {
    get: (...args: unknown[]) => getMock(...args) as unknown,
  },
}));

function mockEvent(id: string, type: "note" | "task" | "message" | "stage_change"): TimelineEventDTO {
  return {
    id,
    type,
    createdAt: new Date().toISOString(),
    authorId: "user-1",
    authorName: "Менеджер",
    data: { title: `Событие ${id}` },
  };
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  getMock.mockReset();
});

describe("useRecordTimeline", () => {
  it("загружает хронологию карточки записи с метаданными пагинации", async () => {
    const items = [
      mockEvent("1", "note"),
      mockEvent("2", "task"),
      mockEvent("3", "stage_change"),
    ];

    getMock.mockResolvedValueOnce({
      data: items,
      meta: { total: 10, limit: 30, offset: 0 },
    });

    const { result } = renderHook(() => useRecordTimeline("deal", "deal-123", { limit: 30, offset: 0 }), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getMock).toHaveBeenCalledWith("/api/v1/crm/records/deal/deal-123/timeline", {
      query: { limit: 30, offset: 0 },
    });

    expect(result.current.data?.items).toHaveLength(3);
    expect(result.current.data?.total).toBe(10);
    expect(result.current.data?.limit).toBe(30);
    expect(result.current.data?.offset).toBe(0);
  });

  it("не отправляет запрос, если id записи null", async () => {
    const { result } = renderHook(() => useRecordTimeline("contact", null), {
      wrapper: makeWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(getMock).not.toHaveBeenCalled();
  });
});
