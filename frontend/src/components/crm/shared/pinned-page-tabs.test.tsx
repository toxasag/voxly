import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PinnedPageTabs } from "@/components/crm/shared/PinnedPageTabs";
import type { RecordDetailTab } from "@/components/crm/shared/RecordDetailShell";

const tabs: RecordDetailTab[] = [
  { id: "home", label: "Главная", content: <p>Поля сделки</p> },
  { id: "chat", label: "Чат", content: <p>Переписка</p> },
  { id: "tasks", label: "Задачи", content: <p>Список задач</p> },
];

describe("PinnedPageTabs", () => {
  it("монтирует Главную один раз и прячет её триггер на десктопе", () => {
    render(<PinnedPageTabs tabs={tabs} />);

    expect(screen.getAllByText("Поля сделки")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Главная" }).className).toContain("md:hidden");
    expect(screen.getByRole("button", { name: "Чат" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Задачи" })).toBeDefined();
  });

  it("переключает остальные вкладки, не размонтируя Главную", async () => {
    render(<PinnedPageTabs tabs={tabs} />);

    await userEvent.click(screen.getByRole("button", { name: "Задачи" }));

    expect(screen.getByText("Список задач")).toBeDefined();
    expect(screen.getByText("Поля сделки")).toBeDefined();
  });

  it("на одном табе оставляет только Главную", () => {
    render(<PinnedPageTabs tabs={[tabs[0]!]} />);

    expect(screen.getByText("Поля сделки")).toBeDefined();
    expect(screen.getByRole("button", { name: "Главная" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Чат" })).toBeNull();
  });
});
