"use client";

import { useCallback, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { MobileNavigationBar } from "@/components/layout/MobileNavigationBar";
import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";
import { cn } from "@/lib/utils";

/**
 * Cookie вместо localStorage: её видит сервер при SSR, поэтому первая отрисовка
 * уже несёт правильную ширину панели и отступ контента. localStorage доступен
 * только после гидратации — страница успевала мигнуть развёрнутым сайдбаром,
 * прежде чем эффект возвращал сохранённое состояние.
 */
const SIDEBAR_COOKIE = "voxly_sidebar_collapsed";

function writeSidebarCookie(collapsed: boolean): void {
  document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Оболочка рабочего пространства.
 *
 * Состояние сворачивания сайдбара живёт здесь, а не внутри Sidebar: отступ
 * контентной колонки должен синхронно меняться с шириной панели, иначе при
 * сворачивании оставалась бы пустая полоса на месте убежавших пунктов меню.
 */
export function DashboardShell({
  children,
  initialCollapsed = false,
}: {
  children: React.ReactNode;
  /** Читается из cookie в серверном layout — без мигания при загрузке. */
  initialCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      writeSidebarCookie(!prev);
      return !prev;
    });
  }, []);

  return (
    <div className="flex min-h-screen bg-white">
      <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
      {/*
        Контент занимает всю ширину правее сайдбара: pl-* повторяет текущую
        ширину панели, transition совпадает с переходом самого aside, поэтому
        сворачивание анимируется бесшовно без горизонтального скролла.

        Отступ только с md:. Без этого условия на телефоне оставалась пустая
        полоса 240px на месте скрытого сайдбара, а страница уезжала за край
        экрана — контент шире окна ровно на ширину панели.
      */}
      <div
        className={cn(
          "flex w-full min-w-0 flex-1 flex-col transition-all duration-200 ease-in-out",
          collapsed ? "md:pl-16" : "md:pl-60",
        )}
      >
        <ImpersonationBanner />
        <Header />
        {/*
          `pb-20` на мобильном — место под нижний бар: он `fixed`, то есть выпадает
          из потока, и без отступа последняя строка списка оказывалась под кнопками
          и не долистывалась. `px-4` вместо `px-6`: на 360px каждый лишний пиксель
          отступа сужает и без того тесную колонку.
        */}
        <main className="w-full min-w-0 flex-1 px-4 pb-20 pt-3 md:px-5 md:py-4 bg-white">{children}</main>
      </div>

      {/* Нижний бар: только на мобильном, где нет сайдбара. */}
      <MobileNavigationBar />
    </div>
  );
}
