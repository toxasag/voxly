import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { DealKanban, type KanbanStageOps } from "@/components/crm/deals/DealKanban";
import type { KanbanColumnDTO } from "@/lib/api/use-deals";

// ---------------------------------------------------------------------------
// Системные этапы воронки в режиме «Настроить».
//
// «Новый лид», «Успешно реализовано» и «Закрыто и не реализовано» держат
// семантику: куда попадает новая сделка и что считать закрытым. Раньше вход в
// воронку ничем не отличался от пользовательского этапа — его можно было
// переименовать, перекрасить, передвинуть и удалить, а закрывающие
// переставлялись в середину доски.
//
// Порядок задан: вход первый, «успех» предпоследний, «провал» последний.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/utils/use-is-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/api/use-deals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/use-deals")>();
  return { ...actual, useMoveDealStage: () => ({ mutate: vi.fn(), isPending: false }) };
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function column(
  index: number,
  name: string,
  flags: { isWon?: boolean; isLost?: boolean; isSystem?: boolean } = {},
): KanbanColumnDTO {
  return {
    stageId: `stage-${index}`,
    stageName: name,
    sortOrder: index,
    isWon: flags.isWon ?? false,
    isLost: flags.isLost ?? false,
    isSystem: flags.isSystem ?? false,
    stageColor: "slate",
    dealCount: 0,
    budgetTotal: 0,
    deals: [],
  };
}

const COLUMNS: KanbanColumnDTO[] = [
  column(0, "Новый лид", { isSystem: true }),
  column(1, "Квалификация"),
  column(2, "В работе"),
  column(3, "Успешно реализовано", { isWon: true, isSystem: true }),
  column(4, "Закрыто и не реализовано", { isLost: true, isSystem: true }),
];

const ops: KanbanStageOps = {
  onCreateStage: vi.fn(),
  onUpdateStage: vi.fn(),
  onDeleteStage: vi.fn(),
  onMoveStageOrder: vi.fn(),
  pending: false,
};

function renderConfigure() {
  return render(
    <DealKanban
      pipelineId="pipe-1"
      columns={COLUMNS}
      usersById={new Map()}
      configure
      stageOps={ops}
    />,
    { wrapper },
  );
}

describe("Системные этапы в режиме настройки", () => {
  it("у системных этапов нет поля переименования", () => {
    renderConfigure();

    // У пользовательских этапов поле есть, у трёх системных — нет.
    const inputs = screen.getAllByRole("textbox");
    const values = inputs.map((input) => (input as HTMLInputElement).value);

    expect(values).toContain("Квалификация");
    expect(values).toContain("В работе");
    expect(values).not.toContain("Новый лид");
    expect(values).not.toContain("Успешно реализовано");
    expect(values).not.toContain("Закрыто и не реализовано");
  });

  it("системные этапы помечены и не предлагают удаление", () => {
    renderConfigure();

    expect(screen.getAllByText("системный")).toHaveLength(3);
    // Корзина только у двух пользовательских этапов.
    expect(screen.getAllByTitle("Удалить стадию")).toHaveLength(2);
  });

  it("первый пользовательский этап нельзя сдвинуть за вход в воронку", () => {
    renderConfigure();

    const left = screen.getAllByTitle("Сдвинуть влево");
    // «Квалификация» стоит сразу после системного входа — влево ходу нет.
    expect((left[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("последний пользовательский этап нельзя сдвинуть за «успех»", () => {
    renderConfigure();

    const right = screen.getAllByTitle("Сдвинуть вправо");
    // «В работе» — последний перед закрывающими.
    expect((right[right.length - 1] as HTMLButtonElement).disabled).toBe(true);
  });

  it("порядок колонок: вход первый, успех предпоследний, провал последний", () => {
    const { container } = renderConfigure();

    const texts = [...container.querySelectorAll("[data-kanban-column]")].map(
      (node) => node.textContent ?? "",
    );

    expect(texts[0]).toContain("Новый лид");
    expect(texts[texts.length - 2]).toContain("Успешно реализовано");
    expect(texts[texts.length - 1]).toContain("Закрыто и не реализовано");
  });
});
