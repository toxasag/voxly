"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Production-grade Portal-rendered Dropdown Menu
//
// Решает проблему Stacking Context, z-index layering и клиппинга всплывающих
// окон контейнерами с `overflow-hidden` / `overflow-y-auto` (таблицы, карточки,
// липкие заголовки, шторки Sheet).
//
// 1. Вынос в Portal (document.body): меню монтируется на самом верхнем уровне DOM,
//    полностью выходя из локального stacking context предков.
// 2. Умное адаптивное позиционирование (Smart Collision Detection & Auto-Flip):
//    вычисляет координаты триггера через getBoundingClientRect(). Если снизу
//    недостаточно места (или задан side="top"), автоматически разворачивается вверх
//    (avoidCollisions={true}), предотвращая уход за границы экрана.
// 3. Ограничение высоты со скроллом (max-h): длинные меню (выбор ролей, права)
//    никогда не выходят за viewport благодаря max-h-[calc(100vh-2rem)] overflow-y-auto.
// 4. Изолированный слой z-[9999]: гарантированно выше любых липких шапок таблиц,
//    сайдбаров и оверлеев.
// 5. Двойной API: поддерживает как компонентный Radix-style API (DropdownMenu,
//    DropdownMenuTrigger, DropdownMenuPortal, DropdownMenuContent, DropdownMenuItem),
//    так и классический compact API (<DropdownMenu trigger={...}>).
// ---------------------------------------------------------------------------

interface DropdownMenuContextValue {
  open: boolean;
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  triggerRef: React.RefObject<HTMLDivElement | null>;
  close: () => void;
}

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(null);

function useDropdownMenuContext() {
  const context = useContext(DropdownMenuContext);
  if (!context) {
    throw new Error("DropdownMenu components must be used within a DropdownMenu provider");
  }
  return context;
}

export interface DropdownMenuRootProps {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Legacy wrapper prop: если передан trigger, работает как компактный контейнер */
  trigger?: ReactNode;
  align?: "left" | "right" | "start" | "end" | "center";
  side?: "top" | "bottom";
  sideOffset?: number;
  avoidCollisions?: boolean;
  collisionPadding?: number;
  panelClassName?: string;
}

export function DropdownMenu({
  children,
  open: controlledOpen,
  onOpenChange,
  trigger,
  align = "right",
  side = "bottom",
  sideOffset = 4,
  avoidCollisions = true,
  collisionPadding = 8,
  panelClassName,
}: DropdownMenuRootProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const triggerRef = useRef<HTMLDivElement | null>(null);

  const setOpen = (updater: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof updater === "function" ? updater(open) : updater;
    if (!isControlled) {
      setUncontrolledOpen(next);
    }
    onOpenChange?.(next);
  };

  const close = () => setOpen(false);

  // Режим компактного использования: <DropdownMenu trigger={<button>...</button>}>...</DropdownMenu>
  if (trigger !== undefined) {
    return (
      <DropdownMenuContext.Provider value={{ open, setOpen, triggerRef, close }}>
        <div className="relative inline-flex" ref={triggerRef}>
          <div
            onClick={(e) => {
              e.stopPropagation();
              setOpen((prev) => !prev);
            }}
          >
            {trigger}
          </div>
          {open && (
            <DropdownMenuPortal>
              <DropdownMenuContent
                align={align}
                side={side}
                sideOffset={sideOffset}
                avoidCollisions={avoidCollisions}
                collisionPadding={collisionPadding}
                className={panelClassName}
              >
                {children}
              </DropdownMenuContent>
            </DropdownMenuPortal>
          )}
        </div>
      </DropdownMenuContext.Provider>
    );
  }

  // Режим расширенного Radix-style API
  return (
    <DropdownMenuContext.Provider value={{ open, setOpen, triggerRef, close }}>
      {children}
    </DropdownMenuContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

export interface DropdownMenuTriggerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  asChild?: boolean;
}

export function DropdownMenuTrigger({
  children,
  className,
  asChild: _asChild,
  onClick,
  ...props
}: DropdownMenuTriggerProps) {
  const { setOpen, triggerRef } = useDropdownMenuContext();

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    onClick?.(e);
    setOpen((prev) => !prev);
  };

  return (
    <div
      ref={triggerRef}
      onClick={handleClick}
      className={cn("inline-flex cursor-pointer select-none", className)}
      aria-haspopup="menu"
      {...props}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Portal
// ---------------------------------------------------------------------------

const DropdownPortalContext = createContext<boolean>(false);

export interface DropdownMenuPortalProps {
  children: ReactNode;
  container?: HTMLElement | null;
}

export function DropdownMenuPortal({ children, container }: DropdownMenuPortalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || typeof document === "undefined") return null;

  return (
    <DropdownPortalContext.Provider value={true}>
      {createPortal(children, container ?? document.body)}
    </DropdownPortalContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Content (Floating Overlay with Collision Detection & Auto-Flip)
// ---------------------------------------------------------------------------

export interface DropdownMenuContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  align?: "left" | "right" | "start" | "end" | "center";
  side?: "top" | "bottom";
  sideOffset?: number;
  avoidCollisions?: boolean;
  collisionPadding?: number;
  className?: string;
}

interface MenuCoords {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  maxHeight: number;
  placement: "top" | "bottom";
}

function DropdownMenuContentPanel({
  children,
  align = "end",
  side = "bottom",
  sideOffset = 4,
  avoidCollisions = true,
  collisionPadding = 8,
  className,
  style,
  ...props
}: DropdownMenuContentProps) {
  const { open, close, triggerRef } = useDropdownMenuContext();
  const contentRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<MenuCoords | null>(null);

  // Вычисление точных координат на экране с авто-разворотом
  const updatePosition = () => {
    if (!triggerRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const contentEl = contentRef.current;

    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    const padding = collisionPadding ?? 8;
    const offset = sideOffset ?? 4;

    const spaceBelow = viewportHeight - triggerRect.bottom - padding - offset;
    const spaceAbove = triggerRect.top - padding - offset;

    const estimatedHeight = contentEl ? contentEl.offsetHeight : 280;

    let placement: "top" | "bottom" = side === "top" ? "top" : "bottom";

    // Умный авто-разворот: если снизу мало места, а сверху больше — разворачиваемся вверх
    if (avoidCollisions) {
      if (placement === "bottom" && spaceBelow < Math.min(estimatedHeight, 260) && spaceAbove > spaceBelow) {
        placement = "top";
      } else if (placement === "top" && spaceAbove < Math.min(estimatedHeight, 260) && spaceBelow > spaceAbove) {
        placement = "bottom";
      }
    }

    let top: number | undefined;
    let bottom: number | undefined;
    let maxHeight: number;

    if (placement === "bottom") {
      top = triggerRect.bottom + offset;
      maxHeight = Math.max(120, spaceBelow);
    } else {
      bottom = viewportHeight - triggerRect.top + offset;
      maxHeight = Math.max(120, spaceAbove);
    }

    const isAlignRight = align === "end" || align === "right";
    const isAlignLeft = align === "start" || align === "left";

    let left: number | undefined;
    let right: number | undefined;

    if (isAlignRight) {
      right = Math.max(padding, viewportWidth - triggerRect.right);
    } else if (isAlignLeft) {
      left = Math.max(padding, triggerRect.left);
    } else {
      // center
      left = Math.max(padding, triggerRect.left + triggerRect.width / 2 - 112);
    }

    setCoords({
      top,
      bottom,
      left,
      right,
      maxHeight,
      placement,
    });
  };

  useLayoutEffect(() => {
    if (open) {
      updatePosition();
    } else {
      setCoords(null);
    }
  }, [open, side, align, sideOffset, avoidCollisions, collisionPadding]);

  useEffect(() => {
    if (!open) return;

    // Реакция на скролл и ресайз окна
    const handleScrollOrResize = () => {
      updatePosition();
    };

    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    // Закрытие по Escape
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!open) return null;

  const dynamicStyle: CSSProperties = {
    position: "fixed",
    zIndex: 9999,
    visibility: coords ? "visible" : "hidden",
    maxHeight: coords ? `${coords.maxHeight}px` : "85vh",
    ...(coords?.top !== undefined ? { top: `${coords.top}px` } : {}),
    ...(coords?.bottom !== undefined ? { bottom: `${coords.bottom}px` } : {}),
    ...(coords?.left !== undefined ? { left: `${coords.left}px` } : {}),
    ...(coords?.right !== undefined ? { right: `${coords.right}px` } : {}),
    ...style,
  };

  return (
    <>
      {/* Прозрачный полноэкранный бэкдроп для клика вне меню */}
      <div
        className="fixed inset-0 z-[9998] cursor-default bg-transparent"
        onClick={(e) => {
          e.stopPropagation();
          close();
        }}
        aria-hidden="true"
      />

      {/* Панель меню с изолированным Stacking Context */}
      <div
        ref={contentRef}
        role="menu"
        style={dynamicStyle}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "w-60 overflow-y-auto rounded-[8px] border border-[#e5e5e5] bg-white p-1 shadow-2xl transition-all duration-100 animate-in fade-in-0 zoom-in-95",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </>
  );
}

export function DropdownMenuContent(props: DropdownMenuContentProps) {
  const isInsidePortal = useContext(DropdownPortalContext);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (isInsidePortal) {
    return <DropdownMenuContentPanel {...props} />;
  }

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(<DropdownMenuContentPanel {...props} />, document.body);
}

// ---------------------------------------------------------------------------
// Items & Components
// ---------------------------------------------------------------------------

export interface DropdownMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
  icon?: LucideIcon;
  label?: string;
  hint?: string;
  danger?: boolean;
  activeArrow?: boolean;
  onSelect?: () => void;
}

export function DropdownMenuItem({
  children,
  icon: Icon,
  label,
  hint,
  danger = false,
  activeArrow = false,
  onSelect,
  onClick,
  className,
  ...props
}: DropdownMenuItemProps) {
  const { close } = useDropdownMenuContext();

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onClick?.(e);
    onSelect?.();
    close();
  };

  return (
    <button
      type="button"
      role="menuitem"
      onClick={handleClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer",
        danger
          ? "text-rose-600 hover:bg-rose-50"
          : "text-[#111111] hover:bg-[#fafafa] hover:text-[#111111]",
        className,
      )}
      {...props}
    >
      {Icon && (
        <Icon className={cn("h-3.5 w-3.5 shrink-0", danger ? "text-rose-600" : "text-[#666666]")} />
      )}
      <span className="flex-1 truncate">{children || label}</span>
      {hint && <span className="text-[11px] text-[#888888]">{hint}</span>}
      {activeArrow && <span className="text-xs text-[#4a38f5]">↓</span>}
    </button>
  );
}

export interface DropdownMenuCheckboxItemProps {
  icon?: LucideIcon;
  label: string;
  checked: boolean;
  onToggle: () => void;
}

export function DropdownMenuCheckboxItem({
  icon: Icon,
  label,
  checked,
  onToggle,
}: DropdownMenuCheckboxItemProps) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-xs text-[#111111] transition-colors hover:bg-[#fafafa] cursor-pointer"
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-[#666666]" />}
      <span className="flex-1 truncate">{label}</span>
      <span
        className={cn(
          "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border text-[10px] font-bold",
          checked ? "border-[#4a38f5] bg-[#4a38f5] text-white" : "border-[#e5e5e5] text-transparent",
        )}
      >
        ✓
      </span>
    </button>
  );
}

export function DropdownMenuLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#888888]",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div className={cn("my-1 border-t border-[#f0f0f0]", className)} />;
}

// ---------------------------------------------------------------------------
// Legacy Aliases for backwards compatibility across GETVOXLY
// ---------------------------------------------------------------------------

export const MenuItem = DropdownMenuItem;
export const MenuCheckboxItem = DropdownMenuCheckboxItem;
export const MenuLabel = DropdownMenuLabel;
export const MenuSeparator = DropdownMenuSeparator;
