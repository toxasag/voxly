"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Menu, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { useHasOpenOverlay } from "@/lib/utils/use-scroll-lock";
import { CommandMenu } from "@/components/shared/CommandMenu";

// ---------------------------------------------------------------------------
// Нижний бар навигации — мобильная замена сайдбара.
//
// На мобильном сайдбара нет вовсе (`hidden md:flex`), поэтому навигация уходит
// сюда и на маршрут `/menu`. Три кнопки, а не полный список разделов: их у портала
// больше десятка вместе с модулями и каналами, и в ряд на 360px влезает три-четыре
// области нажатия по 44px.
//
// `fixed` внизу и `md:hidden`, а не ветка по `useIsMobile`: `matchMedia`
// недоступен при SSR, и бар мигал бы на десктопе при каждой загрузке.
//
// Место под бар даёт `pb-20` у `<main>` в `DashboardShell`: бар выпадает из
// потока, и без отступа последняя строка списка оказывалась бы под кнопками.
// ---------------------------------------------------------------------------

/**
 * Три кнопки: рабочий экран, поиск, полное меню.
 *
 * «Панель» ведёт на `/dashboard` — точку входа, с которой начинается работа.
 * «Меню» — на `/menu`, где лежат все разделы, включая модули и каналы. Полный
 * список в баре не поместился бы: разделов больше десятка, а в ряд на 360px
 * влезает три-четыре области нажатия по 44px.
 *
 * Поиск — не ссылка, а кнопка, поэтому он не в этом списке: палитра открывается
 * оверлеем и своего маршрута не имеет.
 */
const LINKS = [
  { label: "Панель", href: "/dashboard", icon: LayoutGrid },
  { label: "Меню", href: "/menu", icon: Menu },
] as const;

/** Кнопка-ссылка бара: `flex-1` даёт треть ширины — 120px на 360px экране. */
function BarLink({
  item,
  pathname,
}: {
  item: (typeof LINKS)[number];
  pathname: string;
}) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <Link
      href={item.href}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors",
        active ? "text-amber-400" : "text-slate-400",
      )}
    >
      <item.icon className="h-5 w-5" />
      {item.label}
    </Link>
  );
}

export function MobileNavigationBar() {
  const pathname = usePathname();
  const [commandOpen, setCommandOpen] = useState(false);

  // Бар обязан прятаться под открытым оверлеем: он `fixed` с высоким z-index, и
  // иначе кнопки висели бы поверх формы, перекрывая её последнее поле и кнопку
  // отправки. Подписка, а не опрос счётчика: опрос на каждом кадре перерисовывал
  // бы бар 60 раз в секунду впустую.
  const overlayOpen = useHasOpenOverlay();

  return (
    <>
      <nav
        aria-label="Основная навигация"
        className={cn(
          "fixed bottom-0 left-0 right-0 z-30 h-16 items-stretch border-t border-slate-800 bg-slate-900 md:hidden",
          // Скрытие под оверлеем и скрытие на десктопе — одно свойство `display`,
          // поэтому это не два независимых класса, а выбор одного из двух: `flex`
          // против `hidden`. Порядок в CSS решал бы за нас случайно.
          //
          // Само скрытие, а не размонтирование: `CommandMenu` ниже держит
          // состояние поиска, и снятие бара с дерева закрывало бы палитру при
          // открытии любого оверлея.
          overlayOpen ? "hidden" : "flex",
        )}
      >
        {/*
          Порядок: Панель — Поиск — Меню. Поиск в центре не по симметрии: центр
          бара — самая доступная точка для большого пальца, а поиск здесь
          единственный путь к палитре (поля с ⌘K на телефоне нет).
        */}
        <BarLink item={LINKS[0]} pathname={pathname} />

        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium text-slate-400 transition-colors"
        >
          <Search className="h-5 w-5" />
          Поиск
        </button>

        <BarLink item={LINKS[1]} pathname={pathname} />
      </nav>

      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
    </>
  );
}
