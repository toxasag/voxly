import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhonesInput } from "@/components/crm/shared/PhonesInput";
import type { ContactPhoneInput } from "@/schemas/contact.schema";

// ---------------------------------------------------------------------------
// Ввод телефонов.
//
// Тесты написаны по конкретным дефектам, которые пропустили typecheck, lint и
// сборку:
//  - кнопка «Добавить номер» не добавляла строку: пустое значение отбрасывалось
//    фильтром до рендера, и второй телефон нельзя было ввести вовсе;
//  - сохранённые номера показывались пустыми полями: снятие префикса
//    регуляркой /^\+\d+/ съедало весь номер E.164;
//  - смена страны обнуляла введённый номер по той же причине;
//  - черновики ввода ключевались индексом строки, поэтому после удаления номера
//    поле показывало значение другой строки.
//
// Компонент управляемый, поэтому обёртка держит значение в состоянии — как это
// делают форма контакта и карточка.
// ---------------------------------------------------------------------------

function Harness({ initial = [] }: { initial?: ContactPhoneInput[] }) {
  const [phones, setPhones] = useState<ContactPhoneInput[]>(initial);

  return (
    <div>
      <PhonesInput value={phones} onChange={setPhones} />
      {/* Значение, ушедшее наружу: именно оно отправляется на сервер. */}
      <output data-testid="value">{phones.map((phone) => phone.number).join(",")}</output>
    </div>
  );
}

function phoneFields(): HTMLInputElement[] {
  return screen.getAllByPlaceholderText("916 123 45 67");
}

describe("PhonesInput", () => {
  it("показывает сохранённый номер в поле, а не пустую строку", () => {
    render(<Harness initial={[{ number: "+79161234567", country_code: "RU", calling_code: "+7" }]} />);

    const [field] = phoneFields();

    // Раньше здесь была пустая строка: регулярка снимала не префикс, а весь номер.
    expect(field?.value).not.toBe("");
    expect(field?.value.replace(/\D/g, "")).toContain("9161234567");
  });

  it("добавляет вторую строку по кнопке", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ number: "+79161234567", country_code: "RU", calling_code: "+7" }]} />);

    expect(phoneFields()).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Добавить номер" }));

    // Главный сценарий запроса: у клиента несколько номеров.
    expect(phoneFields()).toHaveLength(2);
  });

  it("сохраняет второй введённый номер в значение", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ number: "+79161234567", country_code: "RU", calling_code: "+7" }]} />);

    await user.click(screen.getByRole("button", { name: "Добавить номер" }));

    const fields = phoneFields();
    const second = fields[1];
    expect(second).toBeDefined();

    await user.type(second as HTMLInputElement, "9031112233");

    const value = screen.getByTestId("value").textContent ?? "";
    expect(value).toContain("+79161234567");
    expect(value).toContain("+79031112233");
  });

  it("не теряет номер при смене кода страны", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ number: "+79161234567", country_code: "RU", calling_code: "+7" }]} />);

    await user.selectOptions(screen.getByLabelText("Код страны"), "BY");

    // Национальная часть сохраняется, меняется только префикс.
    const value = screen.getByTestId("value").textContent ?? "";
    expect(value).toBe("+3759161234567");
  });

  it("после удаления первого номера в поле остаётся второй, а не пустая строка", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[
          { number: "+79161234567", country_code: "RU", calling_code: "+7" },
          { number: "+79031112233", country_code: "RU", calling_code: "+7" },
        ]}
      />,
    );

    const [firstRemove] = screen.getAllByRole("button", { name: "Удалить номер" });
    await user.click(firstRemove as HTMLElement);

    const fields = phoneFields();
    expect(fields).toHaveLength(1);
    // Раньше здесь оставался черновик удалённой строки — пустое поле при
    // непустом значении.
    expect(fields[0]?.value.replace(/\D/g, "")).toContain("9031112233");
    expect(screen.getByTestId("value").textContent).toBe("+79031112233");
  });

  it("переставляет номер в начало по кнопке «сделать основным»", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[
          { number: "+79161234567", country_code: "RU", calling_code: "+7" },
          { number: "+79031112233", country_code: "RU", calling_code: "+7" },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Сделать основным" }));

    // Primary у Twenty — позиция 0, поэтому «сделать основным» это перестановка.
    expect(screen.getByTestId("value").textContent).toBe("+79031112233,+79161234567");
  });

  it("помечает номер, не подходящий стране", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const [field] = phoneFields();
    await user.type(field as HTMLInputElement, "123");

    expect(await screen.findByText("Номер не подходит для выбранной страны")).toBeDefined();
  });

  it("не отдаёт наружу пустую строку", () => {
    render(<Harness />);

    // Пустая форма не должна создавать номер, хотя строка ввода отображается.
    expect(phoneFields()).toHaveLength(1);
    expect(screen.getByTestId("value").textContent).toBe("");
  });
});
