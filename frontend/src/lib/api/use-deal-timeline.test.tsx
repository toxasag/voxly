import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { useDealTimeline, type DealMessageDTO } from "@/lib/api/use-deals";

// ---------------------------------------------------------------------------
// Автообновление хронологии сделки.
//
// Дефект, который здесь закрывается: `useDealTimeline` был обычным `useQuery`
// без `refetchInterval`, без SSE и без вебсокета, а инвалидация стояла только
// после собственной отправки. Ответ клиента менеджер видел, лишь нажав F5.
//
// Опрос включается флагом `live` и только у открытой вкладки чата: постоянный
// опрос по всем сделкам — лишняя нагрузка, и решение принимает вкладка, а не
// хук. Проверяются обе ветки, иначе «включили везде» прошло бы незамеченным.
//
// `apiClient` подменён: проверяется поведение запроса по расписанию, а не сеть.
// ---------------------------------------------------------------------------

const getMock = vi.fn();

vi.mock("@/lib/api/apiClient", () => ({
  apiClient: {
    get: (...args: unknown[]) => getMock(...args) as unknown,
  },
}));

function message(id: string): DealMessageDTO {
  return {
    id,
    dealId: "deal-1",
    channelAccountId: null,
    source: "client",
    direction: "inbound",
    senderName: "Клиент",
    content: id,
    channel: "telegram",
    attachment: null,
    attachmentType: null,
    deliveryStatus: "neutral",
    deliveryError: null,
    createdAt: new Date().toISOString(),
  };
}

/** Отдаёт заданный набор сообщений на каждый вызов, включая повторные. */
function respondWith(messages: DealMessageDTO[]): void {
  // `mockImplementation`, а не `mockResolvedValue`: второй не переопределяет
  // ранее поставленную реализацию, и повторный запрос вернул бы прежний ответ —
  // тест показывал бы «данные не обновились» при работающем опросе.
  getMock.mockImplementation(async () => ({ data: messages }));
}

/**
 * Клиент создаётся один раз на тест и передаётся обёртке готовым.
 *
 * Создание внутри компонента-обёртки было бы дефектом теста: обёртка
 * перерисовывается на каждое обновление хука, новый `QueryClient` терял бы кеш,
 * и обновлённые данные не доходили бы до `result.current`.
 */
function makeWrapper() {
  // Повторы выключены: иначе неудачный запрос ждал бы бэкофф.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  getMock.mockReset();
  respondWith([message("first")]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDealTimeline", () => {
  /**
   * Здесь таймеры настоящие, в отличие от остальных тестов файла.
   *
   * С подменёнными таймерами React Query обновляет кеш, но рассылку подписчикам
   * выполняет своим планировщиком, и `result.current` остаётся на прежних данных
   * при уже выполненном запросе. Тест тогда проверял бы внутренности библиотеки,
   * а не то, что видит менеджер. Цена — ожидание одного интервала опроса.
   */
  it("перезапрашивает хронологию по расписанию в режиме live", async () => {
    const { result } = renderHook(() => useDealTimeline("deal-1", true), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getMock).toHaveBeenCalledTimes(1);

    respondWith([message("first"), message("second")]);

    // Именно этого не было: без интервала ответ клиента появлялся только после
    // перезагрузки страницы.
    //
    // Ожидание дольше общего предела (20 с в `vitest.config.ts`), потому что тест
    // ждёт настоящий интервал опроса в 5 секунд, а не мгновенный рендер.
    await waitFor(() => expect(result.current.data).toHaveLength(2), { timeout: 20_000 });
    expect(getMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it("без live не опрашивает повторно", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const { result } = renderHook(() => useDealTimeline("deal-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    // Закрытая вкладка чата не должна держать опрос: иначе это запрос каждые
    // пять секунд на каждую открытую карточку.
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it("не запрашивает ничего без идентификатора сделки", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    renderHook(() => useDealTimeline(null, true), { wrapper: makeWrapper() });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(getMock).not.toHaveBeenCalled();
  });
});
