import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  SourceMultiSelect,
  LEAD_SOURCE_CATALOG,
} from "@/components/settings/SourceMultiSelect";
import type { LeadSource } from "@/lib/api/use-bitrix24";

describe("SourceMultiSelect Component", () => {
  it("contains all 6 canonical lead sources in catalog", () => {
    expect(LEAD_SOURCE_CATALOG).toHaveLength(6);
    const ids = LEAD_SOURCE_CATALOG.map((s) => s.id);
    expect(ids).toContain("whatsapp");
    expect(ids).toContain("max");
    expect(ids).toContain("telegram_personal");
    expect(ids).toContain("telegram_bot");
    expect(ids).toContain("site_widget");
    expect(ids).toContain("manual");
  });

  it("renders default indicator when no sources are selected", () => {
    const handleChange = vi.fn();
    render(<SourceMultiSelect value={[]} onChange={handleChange} />);

    expect(
      screen.getByText("Все источники (заявки из всех каналов)"),
    ).toBeDefined();
    expect(
      screen.getByText("Все источники (без ограничений)"),
    ).toBeDefined();
  });

  it("renders selected source badges when sources are provided", () => {
    const handleChange = vi.fn();
    render(
      <SourceMultiSelect
        value={["whatsapp", "site_widget"]}
        onChange={handleChange}
      />,
    );

    expect(screen.getByText("Ватсап")).toBeDefined();
    expect(screen.getByText("Виджеты на сайтах")).toBeDefined();
    expect(screen.getByText("Выбрано: 2 из 6")).toBeDefined();
  });

  it("opens popover on click and allows toggling an option", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(
      <SourceMultiSelect
        value={["whatsapp"]}
        onChange={handleChange}
      />,
    );

    const trigger = screen.getByRole("button", { name: /источники заявок/i });
    await user.click(trigger);

    // List should show options
    const telegramBotOption = screen.getByRole("button", {
      name: /телеграм боты telegram_bot/i,
    });
    expect(telegramBotOption).toBeDefined();

    await user.click(telegramBotOption);
    expect(handleChange).toHaveBeenCalledWith(["whatsapp", "telegram_bot"]);
  });

  it("supports 'Выбрать все' action", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(
      <SourceMultiSelect
        value={["whatsapp"]}
        onChange={handleChange}
      />,
    );

    const trigger = screen.getByRole("button", { name: /источники заявок/i });
    await user.click(trigger);

    const selectAllBtn = screen.getByRole("button", { name: /выбрать все/i });
    await user.click(selectAllBtn);

    expect(handleChange).toHaveBeenCalledWith([
      "whatsapp",
      "max",
      "telegram_personal",
      "telegram_bot",
      "site_widget",
      "manual",
    ]);
  });
});
