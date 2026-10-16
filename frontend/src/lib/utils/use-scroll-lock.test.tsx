import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useScrollLock, openOverlayCount } from "@/lib/utils/use-scroll-lock";

// ---------------------------------------------------------------------------
// Единая блокировка прокрутки фона.
//
// Дефект, который здесь закрывается, воспроизводится уже сейчас и без мобильного:
// **18 компонентов ставили `document.body.style.overflow` независимо друг от
// друга** (33 обращения — пара «поставил / снял» в каждом). Тот, кто закрывается
// первым, снимает блокировку у всех, кто ещё открыт.
//
// Живой сценарий: карточка контакта → «Удалить» → `ConfirmDialog` поверх неё;
// закрытие подтверждения возвращает прокрутку фону, хотя карточка открыта. На
// телефоне это заметнее — фон уезжает под пальцем, — поэтому правка попала в
// мобильный план, а не в отдельный.
//
// Решение — счётчик открытых оверлеев: блокировка снимается только при обнулении.
// Он же даёт признак «открыт хотя бы один оверлей», который нужен мобильному бару:
// плавающая кнопка не должна висеть поверх открытой формы.
// ---------------------------------------------------------------------------

beforeEach(() => {
  document.body.style.overflow = "";
});

afterEach(() => {
  document.body.style.overflow = "";
});

describe("useScrollLock", () => {
  it("блокирует прокрутку, когда оверлей открыт", () => {
    renderHook(() => useScrollLock(true));

    expect(document.body.style.overflow).toBe("hidden");
    expect(openOverlayCount()).toBe(1);
  });

  it("ничего не делает, когда оверлей закрыт", () => {
    renderHook(() => useScrollLock(false));

    expect(document.body.style.overflow).toBe("");
    expect(openOverlayCount()).toBe(0);
  });

  it("держит блокировку, пока открыт хотя бы один оверлей", () => {
    const outer = renderHook(() => useScrollLock(true));
    const inner = renderHook(() => useScrollLock(true));

    expect(openOverlayCount()).toBe(2);

    inner.unmount();

    // Ровно тот дефект, из-за которого хук появился: закрытие внутреннего
    // диалога возвращало прокрутку фону при открытой карточке под ним.
    expect(document.body.style.overflow).toBe("hidden");
    expect(openOverlayCount()).toBe(1);

    outer.unmount();

    expect(document.body.style.overflow).toBe("");
    expect(openOverlayCount()).toBe(0);
  });

  it("снимает блокировку при закрытии без размонтирования", () => {
    // Частый случай в этом проекте: компонент остаётся в дереве, а `open`
    // становится ложным.
    const { rerender } = renderHook(({ open }: { open: boolean }) => useScrollLock(open), {
      initialProps: { open: true },
    });

    expect(document.body.style.overflow).toBe("hidden");

    rerender({ open: false });

    expect(document.body.style.overflow).toBe("");
    expect(openOverlayCount()).toBe(0);
  });

  it("не считает один оверлей дважды при перерисовке", () => {
    const { rerender } = renderHook(({ open }: { open: boolean }) => useScrollLock(open), {
      initialProps: { open: true },
    });

    rerender({ open: true });
    rerender({ open: true });

    // Счётчик, выросший на каждой перерисовке, никогда не вернулся бы к нулю, и
    // прокрутка осталась бы заблокированной навсегда.
    expect(openOverlayCount()).toBe(1);
  });

  it("восстанавливает прежнее значение overflow, а не затирает его пустой строкой", () => {
    // На случай, если у страницы своя настройка прокрутки: слепое присваивание
    // `""` при закрытии оверлея её потеряло бы.
    document.body.style.overflow = "clip";

    const { unmount } = renderHook(() => useScrollLock(true));
    expect(document.body.style.overflow).toBe("hidden");

    unmount();
    expect(document.body.style.overflow).toBe("clip");
  });

  it("возвращает счётчик к нулю при закрытии в любом порядке", () => {
    const first = renderHook(() => useScrollLock(true));
    const second = renderHook(() => useScrollLock(true));
    const third = renderHook(() => useScrollLock(true));

    expect(openOverlayCount()).toBe(3);

    // Порядок закрытия произвольный: оверлеи закрываются и по Escape, и кликом
    // по фону, и кнопкой — не обязательно в обратном порядке открытия.
    first.unmount();
    third.unmount();
    expect(document.body.style.overflow).toBe("hidden");

    second.unmount();
    expect(document.body.style.overflow).toBe("");
    expect(openOverlayCount()).toBe(0);
  });
});
