import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { CommandMenu } from "@/components/shared/CommandMenu";

// ---------------------------------------------------------------------------
// Палитра поиска на мобильном.
//
// Почему это важнее остальных правок этапа: поиск — одна из трёх кнопок нижнего
// бара, то есть на телефоне главный путь навигации. При этом `pt-[15vh]` вместе с
// `max-h-[50vh]` оставляли список результатов под экранной клавиатурой: она
// занимает около 40% высоты, отступ сверху ещё 15%, и на список оставалась узкая
// полоса. Данные в поиске уже настоящие, а дойти до них пальцем было нельзя.
//
// Проверяются классы, а не геометрия: jsdom не считает раскладку и не показывает
// клавиатуру. Замеры сделаны в браузере отдельно — они не переживают правку файла,
// а этот тест переживает.
// ---------------------------------------------------------------------------

vi.mock("@/lib/api/apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/apiClient")>();
  return { ...actual, apiClient: { get: vi.fn(async () => ({ data: [] })) } };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/auth/use-auth", () => ({
  useAuth: () => ({
    user: { id: "user-1", role: "owner", permissions: new Set(["tenant:admin"]) },
    tenant: { tenantId: "tenant-1", tenantName: "Акме", installedModules: [] },
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderPalette() {
  const { container } = render(<CommandMenu open onOpenChange={vi.fn()} />, { wrapper });
  return container;
}

/** Панель палитры: контейнер поля ввода и списка. */
function panel(_container: HTMLElement): HTMLElement {
  void _container;
  const input = screen.getByPlaceholderText(/Поиск/);
  const found = input.closest("div")?.parentElement;
  if (found === null || found === undefined) throw new Error("Панель палитры не найдена");
  return found;
}

describe("Палитра на мобильном", () => {
  it("занимает весь экран, а не отступает на 15vh", () => {
    const container = renderPalette();
    const overlay = container.firstElementChild as HTMLElement;

    // `pt-[15vh]` съедал 15% высоты сверху, оставляя список под клавиатурой.
    // На мобильном отступа нет, с `md:` он возвращается — на десктопе палитра
    // посередине экрана выглядит привычнее.
    expect(overlay.className).toContain("md:pt-[15vh]");
    expect(overlay.className).not.toMatch(/(^|\s)pt-\[15vh\]/);
  });

  it("панель без ограничения ширины и скруглений на мобильном", () => {
    const container = renderPalette();

    // `max-w-xl` на 360px не мешает, но скругления и рамка по краям экрана
    // выглядят как незакрытое окно: на телефоне палитра — отдельный экран.
    expect(panel(container).className).toContain("md:max-w-xl");
    expect(panel(container).className).toContain("md:rounded-xl");
  });

  it("список результатов растягивается на всю доступную высоту", () => {
    const container = renderPalette();
    const list = panel(container).querySelector<HTMLElement>(".overflow-y-auto");

    // `max-h-[50vh]` вместе с клавиатурой оставлял под список полосу в несколько
    // строк. На мобильном высота ограничивается только самим экраном.
    expect(list?.className).toContain("md:max-h-[50vh]");
    expect(list?.className).not.toMatch(/(^|\s)max-h-\[50vh\]/);
  });

  it("подсказки клавиш скрыты на мобильном", () => {
    renderPalette();

    // `↑ ↓ Навигация` и `↵ Выбрать` относятся к физической клавиатуре, которой на
    // телефоне нет: подсказки занимали бы место в подвале без пользы.
    //
    // Ищем по «Выбрать», а не по «Навигация»: последнее встречается ещё и
    // заголовком секции навигации, и `getByText` брал бы её — тест проверял бы
    // класс заголовка списка, а не подсказки.
    // `closest("div")` от текста «Выбрать» даёт сам `span` подсказки, поэтому
    // берём его родителя — контейнер обеих подсказок.
    const hints = screen.getByText(/Выбрать/).parentElement;
    expect(hints?.className).toContain("hidden");
    expect(hints?.className).toContain("md:flex");
  });

  it("клавиша ESC в поле ввода скрыта на мобильном", () => {
    renderPalette();

    const esc = screen.getByText("ESC");
    expect(esc.className).toContain("hidden");
    expect(esc.className).toContain("md:inline");
  });

  it("поле ввода остаётся сверху", () => {
    const container = renderPalette();
    const input = screen.getByPlaceholderText(/Поиск/);
    const list = panel(container).querySelector(".overflow-y-auto");

    // Порядок важен: поле над списком, иначе клавиатура закрывает именно то, что
    // печатает пользователь.
    expect(input.compareDocumentPosition(list as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("сохраняет счётчик элементов и подвал", () => {
    renderPalette();

    // Счётчик остаётся: он единственный признак того, что поиск что-то нашёл,
    // когда список прокручен.
    expect(screen.getByText(/элементов/)).toBeDefined();
  });
});
