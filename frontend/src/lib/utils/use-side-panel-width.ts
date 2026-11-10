"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "getvoxly.sidePanel.width.v1";
export const DEFAULT_SIDE_PANEL_WIDTH = 560;
export const MIN_SIDE_PANEL_WIDTH = 360;
export const MAX_SIDE_PANEL_WIDTH = 1800;

function clamp(value: number): number {
  const max =
    typeof window !== "undefined"
      ? Math.min(MAX_SIDE_PANEL_WIDTH, Math.max(800, Math.round(window.innerWidth * 0.94)))
      : MAX_SIDE_PANEL_WIDTH;
  return Math.min(max, Math.max(MIN_SIDE_PANEL_WIDTH, Math.round(value)));
}

function readStored(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "number" && Number.isFinite(parsed) ? clamp(parsed) : null;
  } catch {
    return null;
  }
}

export function useSidePanelWidth(): {
  width: number;
  setWidth: (next: number) => void;
} {
  const [width, setLocal] = useState(DEFAULT_SIDE_PANEL_WIDTH);

  useEffect(() => {
    setLocal(readStored() ?? DEFAULT_SIDE_PANEL_WIDTH);
  }, []);

  const setWidth = useCallback((next: number) => {
    const clamped = clamp(next);
    setLocal(clamped);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clamped));
    } catch {
      // Хранилище недоступно — ширина живёт до перезагрузки.
    }
  }, []);

  return { width, setWidth };
}
