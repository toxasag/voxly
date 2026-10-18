import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RecordCellShell } from "@/components/crm/shared/RecordCell";
import { EntityChip, chipInitials } from "@/components/crm/shared/EntityChip";

describe("RecordCellShell", () => {
  it("renders children content cleanly in standard display state", () => {
    render(
      <RecordCellShell>
        <span>Тестовая сделка</span>
      </RecordCellShell>,
    );

    expect(screen.getByText("Тестовая сделка")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Редактировать ячейку" })).toBeNull();
  });

  it("renders emptyLabel placeholder when isEmpty is true", () => {
    render(
      <RecordCellShell isEmpty emptyLabel="дату">
        <span>Не должно быть видно</span>
      </RecordCellShell>,
    );

    expect(screen.getByText("Указать дату")).toBeDefined();
  });

  it("renders pencil edit button when editable is true", () => {
    const onStartEdit = vi.fn();
    render(
      <RecordCellShell editable onStartEdit={onStartEdit}>
        <span>15 фев., 2026</span>
      </RecordCellShell>,
    );

    const editBtn = screen.getByRole("button", { name: "Редактировать ячейку" });
    expect(editBtn).not.toBeNull();
  });

  it("calls onStartEdit and stops propagation when clicking pencil button", async () => {
    const user = userEvent.setup();
    const onStartEdit = vi.fn();
    const onRowClick = vi.fn();

    render(
      <div onClick={onRowClick}>
        <RecordCellShell editable onStartEdit={onStartEdit}>
          <span>100 000 ₽</span>
        </RecordCellShell>
      </div>,
    );

    const editBtn = screen.getByRole("button", { name: "Редактировать ячейку" });
    await user.click(editBtn);

    expect(onStartEdit).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("calls onStartEdit when clicking editable cell body", async () => {
    const user = userEvent.setup();
    const onStartEdit = vi.fn();
    const onRowClick = vi.fn();

    render(
      <div onClick={onRowClick}>
        <RecordCellShell editable onStartEdit={onStartEdit}>
          <span>Тестовая сумма</span>
        </RecordCellShell>
      </div>,
    );

    await user.click(screen.getByText("Тестовая сумма"));

    expect(onStartEdit).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("allows clicking pencil to edit identifier column while clicking text bubbles to row", async () => {
    const user = userEvent.setup();
    const onStartEdit = vi.fn();
    const onRowClick = vi.fn();

    render(
      <div onClick={onRowClick}>
        <RecordCellShell editable isLabelIdentifier onStartEdit={onStartEdit}>
          <span>AI Model Training</span>
        </RecordCellShell>
      </div>,
    );

    // Clicking text bubbles to row click
    await user.click(screen.getByText("AI Model Training"));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onStartEdit).not.toHaveBeenCalled();

    // Clicking pencil button opens inline edit
    const editBtn = screen.getByRole("button", { name: "Редактировать ячейку" });
    await user.click(editBtn);
    expect(onStartEdit).toHaveBeenCalledTimes(1);
  });
});

describe("EntityChip", () => {
  it("generates single initial for Twenty style singleLetter mode", () => {
    expect(chipInitials("Platform Migration", true)).toBe("P");
    expect(chipInitials("AI Model Training", true)).toBe("A");
    expect(chipInitials("Notion", true)).toBe("N");
  });

  it("renders Twenty table size chip with single letter", () => {
    render(<EntityChip name="Platform Migration" size="table" singleLetter />);
    expect(screen.getByText("P")).toBeDefined();
  });

  it("renders small entity pill with label for relations", () => {
    render(<EntityChip name="Stripe" label="Stripe" size="sm" />);
    expect(screen.getByText("Stripe")).toBeDefined();
  });
});
