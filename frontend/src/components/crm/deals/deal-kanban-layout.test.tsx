import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { DealKanban } from "@/components/crm/deals/DealKanban";
import type { KanbanColumnDTO } from "@/lib/api/use-deals";

// ---------------------------------------------------------------------------
// Канбан — горизонтальная лента колонок фиксированной ширины.
//
// Дефект: `grid-cols-[repeat(auto-fit,minmax(230px,1fr))]` растягивал колонки
// на всю ширину и переносил лишние на второй ряд. На проде шесть этапов
// «ломались»: три сверху, три снизу, шапки этапов оказывались не в одной линии.
//
// Twenty RecordBoard держит колонки в одном ряду с горизонтальным скроллом
// (`flex` + `overflow-x-auto` + фиксированная ширина). Тот же паттерн.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/utils/use-is-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/lib/api/use-deals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/use-deals")>();
  return {
    ...actual,
    useMoveDealStage: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function column(index: number, name: string): KanbanColumnDTO {
  return {
    stageId: `stage-${index}`,
    stageName: name,
    sortOrder: index,
    isWon: false,
    isLost: false,
    isSystem: false,
    stageColor: "amber",
    dealCount: 0,
    budgetTotal: 0,
    deals: [],
  };
}

const COLUMNS = [
  column(0, "Новый лид"),
  column(1, "Квалификация"),
  column(2, "Предложение"),
  column(3, "Переговоры"),
  column(4, "Успех"),
  column(5, "Провал"),
];

describe("DealKanban layout", () => {
  it("держит этапы в одном горизонтальном ряду, не auto-fit сеткой", () => {
    const { container } = render(
      <DealKanban pipelineId="pipe-1" columns={COLUMNS} usersById={new Map()} />,
      { wrapper },
    );

    const board = container.firstElementChild;
    expect(board?.className).toContain("overflow-x-auto");
    expect(board?.className).toContain("flex");
    expect(board?.className).not.toContain("auto-fit");
    expect(board?.className).not.toContain("grid-cols-");
  });

  it("рисует все шесть этапов в порядке sortOrder", () => {
    render(<DealKanban pipelineId="pipe-1" columns={COLUMNS} usersById={new Map()} />, { wrapper });

    const names = COLUMNS.map((col) => col.stageName);
    for (const name of names) {
      expect(screen.getByText(name)).toBeDefined();
    }
  });

  it("фиксирует ширину колонки, чтобы 1fr не растягивал этапы", () => {
    const { container } = render(
      <DealKanban pipelineId="pipe-1" columns={COLUMNS} usersById={new Map()} />,
      { wrapper },
    );

    const columns = [...container.querySelectorAll("[data-kanban-column]")];
    expect(columns).toHaveLength(6);
    for (const col of columns) {
      expect(col.className).toContain("shrink-0");
      expect((col as HTMLElement).style.width).toBe("280px");
    }
  });
});
