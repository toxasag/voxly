import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SocialsInput } from "@/components/crm/shared/SocialsInput";
import type { ContactSocialInput } from "@/schemas/contact.schema";

// ---------------------------------------------------------------------------
// Ввод соцсетей.
//
// Тесты по дефектам, которые пропустили typecheck, lint и сборку:
//  - кнопка «Добавить сеть» не добавляла строку (пустое значение отбрасывалось
//    фильтром до рендера), поэтому второй мессенджер нельзя было ввести;
//  - выбор сети до ввода значения откатывался на Telegram.
// ---------------------------------------------------------------------------

function Harness({ initial = [] }: { initial?: ContactSocialInput[] }) {
  const [socials, setSocials] = useState<ContactSocialInput[]>(initial);

  return (
    <div>
      <SocialsInput value={socials} onChange={setSocials} />
      <output data-testid="value">
        {socials.map((entry) => `${entry.kind}:${entry.value}`).join(",")}
      </output>
    </div>
  );
}

describe("SocialsInput", () => {
  it("добавляет вторую строку по кнопке", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ kind: "telegram", value: "@ivan" }]} />);

    expect(screen.getAllByLabelText("Сеть")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Добавить сеть" }));

    expect(screen.getAllByLabelText("Сеть")).toHaveLength(2);
  });

  it("сохраняет выбор сети до ввода значения", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const [select] = screen.getAllByLabelText("Сеть");
    await user.selectOptions(select as HTMLSelectElement, "whatsapp");

    // Раньше выбор откатывался на telegram: строка с пустым значением
    // отбрасывалась, и компонент перерисовывался из дефолта.
    expect((select as HTMLSelectElement).value).toBe("whatsapp");
  });

  it("сохраняет вторую сеть в значение", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ kind: "telegram", value: "@ivan" }]} />);

    await user.click(screen.getByRole("button", { name: "Добавить сеть" }));

    const selects = screen.getAllByLabelText("Сеть");
    await user.selectOptions(selects[1] as HTMLSelectElement, "max");
    await user.type(screen.getByPlaceholderText("@username или номер"), "@ivanmax");

    expect(screen.getByTestId("value").textContent).toBe("telegram:@ivan,max:@ivanmax");
  });

  it("удаляет строку и оставляет остальные значения", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[
          { kind: "telegram", value: "@ivan" },
          { kind: "vk", value: "ivan" },
        ]}
      />,
    );

    const [firstRemove] = screen.getAllByRole("button", { name: "Удалить профиль" });
    await user.click(firstRemove as HTMLElement);

    expect(screen.getByTestId("value").textContent).toBe("vk:ivan");
  });

  it("не отдаёт наружу профиль без значения", () => {
    render(<Harness />);

    expect(screen.getAllByLabelText("Сеть")).toHaveLength(1);
    expect(screen.getByTestId("value").textContent).toBe("");
  });
});
