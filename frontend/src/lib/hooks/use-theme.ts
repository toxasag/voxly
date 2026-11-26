"use client";

import { useCallback, useEffect } from "react";

// ---------------------------------------------------------------------------
// Тема оформления GETVOXLY.
//
// Дизайн-стандарт: Twenty CRM Light Canvas (строго светлая тема).
// Поддержка тёмной темы отключена для обеспечения консистентности интерфейса,
// читаемости таблиц/виджетов и предотвращения деградации контраста.
// Хранилище сбрасывается в 'light', класс 'dark' принудительно удаляется.
// ---------------------------------------------------------------------------

export type Theme = "light";

export const THEME_STORAGE_KEY = "getvoxly_theme";

function forceLightTheme(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
    document.documentElement.style.colorScheme = "light";
  } catch (e) {}
}

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  useEffect(() => {
    forceLightTheme();
  }, []);

  const toggleTheme = useCallback(() => {
    // No-op: платформа всегда зафиксирована в светлой теме
    forceLightTheme();
  }, []);

  return { theme: "light", toggleTheme };
}
