import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRecordParam } from "@/lib/utils/use-record-param";

// ---------------------------------------------------------------------------
// Открытая карточка в адресе страницы.
//
// Хук появился как условие работоспособности поиска: палитра обязана открывать
// саму запись, а у карточек контакта и компании своего маршрута нет — они
// открываются панелью поверх списка.
//
// Проверяется то, что легко сделать почти правильно:
//  - `push` при открытии и `replace` при закрытии. Одинаковый метод в обоих
//    случаях копил бы историю: «назад» открывало бы только что закрытую карточку
//    либо, наоборот, вообще не закрывало бы её;
//  - чужие параметры адреса сохраняются — на списках рядом живут фильтры и
//    страница, и открытие карточки не должно их сбрасывать;
//  - изменение адреса извне (кнопка «назад», ссылка из палитры) меняет состояние.
// ---------------------------------------------------------------------------

const pushMock = vi.fn();
const replaceMock = vi.fn();

let currentParams = new URLSearchParams();
const PATHNAME = "/crm/contacts";

vi.mock("next/navigation", () => ({
  usePathname: () => PATHNAME,
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  useSearchParams: () => currentParams,
}));

beforeEach(() => {
  pushMock.mockReset();
  replaceMock.mockReset();
  currentParams = new URLSearchParams();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useRecordParam", () => {
  it("читает открытую запись из адреса", () => {
    currentParams = new URLSearchParams("record=contact-1");

    const { result } = renderHook(() => useRecordParam());

    // Обновление страницы с открытой карточкой обязано вернуть её же.
    expect(result.current.recordId).toBe("contact-1");
  });

  it("возвращает null, когда параметра нет", () => {
    const { result } = renderHook(() => useRecordParam());

    expect(result.current.recordId).toBeNull();
  });

  it("открывает запись через push", () => {
    const { result } = renderHook(() => useRecordParam());

    act(() => result.current.openRecord("contact-7"));

    // `push`, потому что открытие — шаг вперёд: «назад» должно закрывать карточку,
    // а на телефоне это единственный привычный способ её закрыть.
    expect(pushMock).toHaveBeenCalledWith("/crm/contacts?record=contact-7", { scroll: false });
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("отражает открытие сразу, не дожидаясь навигации", () => {
    const { result } = renderHook(() => useRecordParam());

    act(() => result.current.openRecord("contact-7"));

    // Навигация Next.js асинхронна: без локальной копии карточка появлялась бы
    // через кадр-два, и на списке это читается как «клик не сработал».
    expect(result.current.recordId).toBe("contact-7");
  });

  it("закрывает запись через replace", () => {
    currentParams = new URLSearchParams("record=contact-1");

    const { result } = renderHook(() => useRecordParam());

    act(() => result.current.closeRecord());

    // `replace`, иначе каждое открытие-закрытие копило бы историю, и «назад»
    // снова открывало бы только что закрытую карточку.
    expect(replaceMock).toHaveBeenCalledWith("/crm/contacts", { scroll: false });
    expect(pushMock).not.toHaveBeenCalled();
    expect(result.current.recordId).toBeNull();
  });

  it("сохраняет чужие параметры при открытии", () => {
    currentParams = new URLSearchParams("search=иван&page=3");

    const { result } = renderHook(() => useRecordParam());

    act(() => result.current.openRecord("contact-7"));

    // На списках рядом живут фильтры и номер страницы: открытие карточки не
    // должно сбрасывать поиск и возвращать пользователя на первую страницу.
    const url = pushMock.mock.calls[0]?.[0] as string;
    const params = new URLSearchParams(url.split("?")[1]);

    expect(params.get("search")).toBe("иван");
    expect(params.get("page")).toBe("3");
    expect(params.get("record")).toBe("contact-7");
  });

  it("сохраняет чужие параметры при закрытии", () => {
    currentParams = new URLSearchParams("search=иван&record=contact-1");

    const { result } = renderHook(() => useRecordParam());

    act(() => result.current.closeRecord());

    const url = replaceMock.mock.calls[0]?.[0] as string;
    expect(url).toBe("/crm/contacts?search=%D0%B8%D0%B2%D0%B0%D0%BD");
  });

  it("следует за изменением адреса извне", () => {
    const { result, rerender } = renderHook(() => useRecordParam());

    expect(result.current.recordId).toBeNull();

    // Так выглядит переход «назад» или ссылка из палитры поиска: адрес меняется,
    // а состояние обязано за ним последовать.
    currentParams = new URLSearchParams("record=contact-9");
    rerender();

    expect(result.current.recordId).toBe("contact-9");
  });

  it("работает с произвольным именем параметра", () => {
    currentParams = new URLSearchParams("company=company-3");

    const { result } = renderHook(() => useRecordParam("company"));

    // На странице контактов открываются две карточки — контакта и компании,
    // поэтому имя параметра задаётся вызывающим.
    expect(result.current.recordId).toBe("company-3");
  });
});
