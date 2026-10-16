import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Building2 } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { RecordField, RecordFieldLink } from "./RecordField";

const base = { icon: Building2, label: "Компания", value: "Audit" };

describe("RecordField interaction", () => {
  it.each(["{Enter}", " "])("opens the field itself with %s", async (key) => {
    const edit = vi.fn();
    render(<RecordField {...base} onStartEdit={edit} />);
    screen.getByRole("button").focus();
    await userEvent.setup().keyboard(key);
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it.each(["{Enter}", " "])("activates the relation, not its field, with %s", async (key) => {
    const edit = vi.fn();
    const open = vi.fn();
    const { container } = render(
      <RecordField {...base} onStartEdit={edit} display={
        <button onClick={(event) => { event.stopPropagation(); open(); }}>Открыть компанию</button>
      } />,
    );
    expect(container.querySelector("button button")).toBeNull();
    screen.getByText("Открыть компанию").focus();
    await userEvent.setup().keyboard(key);
    expect(open).toHaveBeenCalledTimes(1);
    expect(edit).not.toHaveBeenCalled();
  });

  it("does not steal a link's Enter key", () => {
    const edit = vi.fn();
    render(<RecordField {...base} onStartEdit={edit} display={<RecordFieldLink href="https://example.test" label="Сайт" />} />);
    const link = screen.getByRole("link");
    expect(fireEvent.keyDown(link, { key: "Enter" })).toBe(true);
    expect(edit).not.toHaveBeenCalled();
  });

  it("keeps pointer editing and relation navigation separate", async () => {
    const edit = vi.fn();
    const open = vi.fn();
    const { container } = render(<RecordField {...base} onStartEdit={edit} display={
      <button onClick={(event) => { event.stopPropagation(); open(); }}>Связь</button>
    } />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Связь"));
    expect(open).toHaveBeenCalledTimes(1);
    expect(edit).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('div[role="button"]')!);
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it("does not offer editing for read-only values", () => {
    const edit = vi.fn();
    render(<RecordField {...base} readOnly onStartEdit={edit} />);
    expect(screen.queryByRole("button")).toBeNull();
    fireEvent.click(screen.getByText("Audit"));
    fireEvent.keyDown(screen.getByText("Audit"), { key: "Enter" });
    expect(edit).not.toHaveBeenCalled();
  });
});
