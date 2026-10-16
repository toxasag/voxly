import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Sheet } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { openOverlayCount } from "@/lib/utils/use-scroll-lock";

// ---------------------------------------------------------------------------
// Вложенные оверлеи: настоящие компоненты, а не хук напрямую.
//
// Тест на сам `useScrollLock` проверяет счётчик; этот проверяет, что 18
// компонентов действительно на него переведены. Без него правка легко разошлась
// бы: хук есть, тесты хука зелёные, а компонент по-прежнему трогает
// `document.body.style.overflow` напрямую.
//
// Сценарий взят из плана дословно: карточка контакта → «Удалить» →
// `ConfirmDialog` поверх неё → отмена. До правки закрытие подтверждения
// возвращало прокрутку фону, хотя карточка осталась открытой. `Sheet` здесь
// стоит за карточку — он и есть её оболочка.
// ---------------------------------------------------------------------------

/** Карточка с диалогом подтверждения поверх — как на странице контактов. */
function CardWithConfirm() {
  const [cardOpen, setCardOpen] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <Sheet open={cardOpen} onClose={() => setCardOpen(false)}>
        <button type="button" onClick={() => setConfirmOpen(true)}>Удалить</button>
        <button type="button" onClick={() => setCardOpen(false)}>Закрыть карточку</button>
      </Sheet>
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => setConfirmOpen(false)}
        title="Удалить контакт?"
        cancelLabel="Отмена"
      />
    </>
  );
}

beforeEach(() => {
  document.body.style.overflow = "";
});

afterEach(() => {
  document.body.style.overflow = "";
});

describe("Вложенные оверлеи", () => {
  it("отмена подтверждения не возвращает прокрутку фону при открытой карточке", async () => {
    render(<CardWithConfirm />);

    // Карточка открыта — прокрутка фона заблокирована.
    expect(document.body.style.overflow).toBe("hidden");
    expect(openOverlayCount()).toBe(1);

    await userEvent.click(screen.getByRole("button", { name: "Удалить" }));

    expect(openOverlayCount()).toBe(2);

    await userEvent.click(screen.getByRole("button", { name: "Отмена" }));

    // Ровно тот дефект, из-за которого правка попала в план: фон уезжал под
    // пальцем при открытой карточке.
    expect(document.body.style.overflow).toBe("hidden");
    expect(openOverlayCount()).toBe(1);
  });

  it("прокрутка возвращается, когда закрыт последний оверлей", async () => {
    render(<CardWithConfirm />);

    await userEvent.click(screen.getByRole("button", { name: "Удалить" }));
    await userEvent.click(screen.getByRole("button", { name: "Отмена" }));
    await userEvent.click(screen.getByRole("button", { name: "Закрыть карточку" }));

    expect(document.body.style.overflow).toBe("");
    expect(openOverlayCount()).toBe(0);
  });

  it("подтверждение действия тоже оставляет блокировку на карточке", async () => {
    render(<CardWithConfirm />);

    await userEvent.click(screen.getByRole("button", { name: "Удалить" }));
    await userEvent.click(screen.getByRole("button", { name: "Подтвердить" }));

    // Второй путь закрытия диалога — не только «Отмена»: у оверлеев их три
    // (кнопка, Escape, клик по фону), и все ведут через тот же счётчик.
    expect(document.body.style.overflow).toBe("hidden");
    expect(openOverlayCount()).toBe(1);
  });

  it("Escape закрывает только верхний оверлей, а не все сразу", async () => {
    render(<CardWithConfirm />);

    await userEvent.click(screen.getByRole("button", { name: "Удалить" }));
    expect(screen.getByText("Удалить контакт?")).toBeDefined();

    await userEvent.keyboard("{Escape}");

    // Дефект, найденный этим тестом (вне плана, того же класса, что и скролл):
    // каждый из 18 оверлеев вешал свой слушатель `keydown` на `document`,
    // поэтому Escape над диалогом убирал и диалог, и карточку под ним — человек
    // терял контекст, хотя отменил только удаление.
    expect(screen.queryByText("Удалить контакт?")).toBeNull();
    expect(screen.getByRole("button", { name: "Удалить" })).toBeDefined();
    expect(document.body.style.overflow).toBe("hidden");
    expect(openOverlayCount()).toBe(1);
  });

  it("второй Escape закрывает карточку", async () => {
    render(<CardWithConfirm />);

    await userEvent.click(screen.getByRole("button", { name: "Удалить" }));
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");

    // Стек разбирается по одному: закрыв диалог, Escape доходит до карточки —
    // но следующим нажатием, а не тем же.
    expect(screen.queryByRole("button", { name: "Удалить" })).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(openOverlayCount()).toBe(0);
  });
});
