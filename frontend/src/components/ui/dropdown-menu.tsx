"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Лёгкий dropdown-меню без Radix: проект пока не тянет примитивы Radix, а
// три самодельных меню (сайдбар, хедер, нотификации) уже разошлись бы в
// поведении. Один компонент — одно поведение: клик вне и Escape закрывают,
// пункты с onSelect закрывают сами, чекбоксы и раскрытие подблока — нет.
// ---------------------------------------------------------------------------

interface MenuContextValue {
  close: () => void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

interface DropdownMenuProps {
  /** Кнопка-триггер; клик переключает панель. */
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  panelClassName?: string;
}

export function DropdownMenu({ trigger, children, align = "right", panelClassName }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <div onClick={() => setOpen((prev) => !prev)}>{trigger}</div>
      {open && (
        <MenuContext.Provider value={{ close: () => setOpen(false) }}>
          <div
            role="menu"
            onClick={(event) => event.stopPropagation()}
            className={cn(
              "absolute top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-slate-800 bg-slate-900 py-1.5 shadow-2xl",
              align === "right" ? "right-0" : "left-0",
              panelClassName,
            )}
          >
            {children}
          </div>
        </MenuContext.Provider>
      )}
    </div>
  );
}

function useMenuClose(): MenuContextValue {
  const context = useContext(MenuContext);
  if (context === null) throw new Error("Menu items must be used inside DropdownMenu");
  return context;
}

interface MenuItemProps {
  icon?: LucideIcon;
  label: string;
  hint?: string;
  onSelect: () => void;
  danger?: boolean;
  activeArrow?: boolean;
}

export function MenuItem({ icon: Icon, label, hint, onSelect, danger = false, activeArrow = false }: MenuItemProps) {
  const { close } = useMenuClose();

  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => { onSelect(); close(); }}
      className={cn(
        "flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm transition-colors",
        danger ? "text-rose-400 hover:bg-rose-500/10" : "text-slate-300 hover:bg-slate-800 hover:text-slate-100",
      )}
    >
      {Icon && <Icon className={cn("h-4 w-4 shrink-0", danger ? "text-rose-400" : "text-slate-500")} />}
      <span className="flex-1 truncate">{label}</span>
      {hint && <span className="text-xs text-slate-600">{hint}</span>}
      {activeArrow && <span className="text-xs text-amber-400">↓</span>}
    </button>
  );
}

interface MenuCheckboxItemProps {
  icon?: LucideIcon;
  label: string;
  checked: boolean;
  onToggle: () => void;
}

export function MenuCheckboxItem({ icon: Icon, label, checked, onToggle }: MenuCheckboxItemProps) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100"
    >
      {Icon && <Icon className="h-4 w-4 shrink-0 text-slate-500" />}
      <span className="flex-1 truncate">{label}</span>
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border text-xs font-bold",
          checked ? "border-emerald-500 bg-emerald-500/20 text-emerald-400" : "border-slate-700 text-transparent",
        )}
      >
        ✓
      </span>
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-3.5 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
      {children}
    </p>
  );
}

export function MenuSeparator() {
  return <div className="my-1.5 border-t border-slate-800" />;
}
