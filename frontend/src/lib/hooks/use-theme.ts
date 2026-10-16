"use client";

import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Тема оформления.
//
// Раньше состояние жило внутри `Header` и терялось при перезагрузке: класс на
// <html> ставился, но выбор нигде не сохранялся, а исходное состояние всегда
// считалось тёмным — даже если на <html> уже стоял `light`.
//
// Здесь выбор сохраняется в localStorage и читается при монтировании, а сам
// класс на <html> ставит инлайновый скрипт из layout.tsx до первой отрисовки,
// чтобы не было вспышки чужой темы.
// ---------------------------------------------------------------------------

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "getvoxly_theme";

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
}

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;

  // Фолбэк на фактический класс: его уже выставил инлайновый скрипт.
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  // Инициализация значением по умолчанию (светлая тема), а не из localStorage:
  // на сервере его нет, и рассинхрон разметки вызвал бы ошибку гидрации.
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const initial = readStoredTheme();
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
