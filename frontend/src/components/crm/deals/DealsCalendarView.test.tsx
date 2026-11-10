import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DealsCalendarView } from "@/components/crm/deals/DealsCalendarView";
import type { DealDTO } from "@/lib/api/use-deals";
import type { TenantUserDTO } from "@/lib/api/use-tenant-users";

const stagesById = new Map([
  ["stage-1", { name: "Новый лид", colorKey: "amber", isWon: false, isLost: false }],
  ["stage-2", { name: "Успешно", colorKey: "emerald", isWon: true, isLost: false }],
]);

const usersById = new Map<string, TenantUserDTO>([
  [
    "user-1",
    {
      id: "user-1",
      email: "manager@test.com",
      fullName: "Иван Менеджер",
      role: "manager",
      avatarUrl: null,
    },
  ],
]);

function mockDeal(overrides: Partial<DealDTO> = {}): DealDTO {
  return {
    id: "deal-1",
    pipelineId: "pipe-1",
    stageId: "stage-1",
    contactId: null,
    companyId: null,
    title: "Внедрение CRM",
    description: "Тестовая сделка",
    budget: 250000,
    currency: "RUB",
    customFields: {},
    createdBy: "user-1",
    ownerId: "user-1",
    closeDate: null,
    position: 0,
    closedAt: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    companyName: "ООО Вектор",
    contactName: "Алексей Иванов",
    ownerName: "Иван Менеджер",
    ...overrides,
  };
}

describe("DealsCalendarView", () => {
  it("рендерит заголовок месяца, дни недели и кнопку Сегодня", () => {
    render(
      <DealsCalendarView
        deals={[]}
        stagesById={stagesById}
        usersById={usersById}
      />,
    );

    expect(screen.getByText("Сегодня")).toBeDefined();
    expect(screen.getByText("Пн")).toBeDefined();
    expect(screen.getByText("Вс")).toBeDefined();
    expect(screen.getByTitle("Предыдущий месяц")).toBeDefined();
    expect(screen.getByTitle("Следующий месяц")).toBeDefined();
  });

  it("выводит кнопку и панель для сделок без даты закрытия", async () => {
    const deals = [
      mockDeal({ id: "d-unscheduled", title: "Сделка без даты", closeDate: null }),
    ];

    render(
      <DealsCalendarView
        deals={deals}
        stagesById={stagesById}
        usersById={usersById}
      />,
    );

    const unscheduledBtn = screen.getByText(/Без даты \(1\)/);
    expect(unscheduledBtn).toBeDefined();

    const user = userEvent.setup();
    await user.click(unscheduledBtn);

    expect(screen.getByText("Сделка без даты")).toBeDefined();
    expect(screen.getByText(/250\s*000/)).toBeDefined();
  });

  it("вызывает onOpenDeal при клике на сделку", async () => {
    const onOpenDeal = vi.fn();
    const deals = [
      mockDeal({
        id: "d-123",
        title: "Срочная сделка",
        closeDate: null,
      }),
    ];

    render(
      <DealsCalendarView
        deals={deals}
        stagesById={stagesById}
        usersById={usersById}
        onOpenDeal={onOpenDeal}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByText(/Без даты/));
    await user.click(screen.getByText("Срочная сделка"));

    expect(onOpenDeal).toHaveBeenCalledWith("d-123");
  });

  it("отображает сделку в ячейке дня, если указан closeDate", () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const todayIso = `${year}-${month}-${day}`;

    const deals = [
      mockDeal({
        id: "d-today",
        title: "Сделка на сегодня",
        closeDate: todayIso,
        budget: 500000,
      }),
    ];

    render(
      <DealsCalendarView
        deals={deals}
        stagesById={stagesById}
        usersById={usersById}
      />,
    );

    expect(screen.getByText("Сделка на сегодня")).toBeDefined();
    expect(screen.getAllByText(/500\s*000/).length).toBeGreaterThan(0);
  });
});
