"use client";

import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface SelectContextValue {
  value: string;
  onValueChange: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  selectedLabel: ReactNode;
  setSelectedLabel: (label: ReactNode) => void;
  disabled?: boolean;
}

const SelectContext = createContext<SelectContextValue | null>(null);

function useSelectContext() {
  const context = useContext(SelectContext);
  if (!context) {
    throw new Error("Select compound components must be used within a Select provider");
  }
  return context;
}

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}

export function Select({
  value: controlledValue,
  defaultValue = "",
  onValueChange,
  open: controlledOpen,
  onOpenChange,
  disabled = false,
  children,
}: SelectProps) {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const isControlledValue = controlledValue !== undefined;
  const value = isControlledValue ? controlledValue : uncontrolledValue;

  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlledOpen = controlledOpen !== undefined;
  const open = isControlledOpen ? controlledOpen : uncontrolledOpen;

  const [selectedLabel, setSelectedLabel] = useState<ReactNode>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const setOpen = (updater: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof updater === "function" ? updater(open) : updater;
    if (!isControlledOpen) {
      setUncontrolledOpen(next);
    }
    onOpenChange?.(next);
  };

  const handleValueChange = (newVal: string) => {
    if (!isControlledValue) {
      setUncontrolledValue(newVal);
    }
    onValueChange?.(newVal);
    setOpen(false);
  };

  return (
    <SelectContext.Provider
      value={{
        value,
        onValueChange: handleValueChange,
        open,
        setOpen,
        triggerRef,
        selectedLabel,
        setSelectedLabel,
        disabled,
      }}
    >
      {children}
    </SelectContext.Provider>
  );
}

export interface SelectTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string;
  children?: ReactNode;
}

export function SelectTrigger({
  className,
  children,
  ...props
}: SelectTriggerProps) {
  const { open, setOpen, triggerRef, disabled } = useSelectContext();

  return (
    <button
      ref={triggerRef}
      type="button"
      role="combobox"
      aria-expanded={open}
      disabled={disabled || props.disabled}
      onClick={() => setOpen((prev) => !prev)}
      className={cn(
        "flex h-8 w-full items-center justify-between rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-[13px] text-[#111111] shadow-2xs transition-colors",
        "placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
        "disabled:cursor-not-allowed disabled:bg-[#fafafa] disabled:text-[#888888]",
        open && "border-[#4a38f5] ring-1 ring-[#4a38f5]/20",
        className,
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      <ChevronDown
        className={cn(
          "ml-2 h-3.5 w-3.5 shrink-0 text-[#888888] transition-transform duration-150",
          open && "rotate-180",
        )}
      />
    </button>
  );
}

export interface SelectValueProps {
  placeholder?: string;
  className?: string;
}

export function SelectValue({ placeholder = "Выберите...", className }: SelectValueProps) {
  const { value, selectedLabel } = useSelectContext();

  return (
    <span className={cn("block truncate", !value && "text-[#888888]", className)}>
      {selectedLabel ?? value ?? placeholder}
    </span>
  );
}

export interface SelectContentProps {
  className?: string;
  children: ReactNode;
  align?: "start" | "end" | "center";
}

export function SelectContent({
  className,
  children,
  align = "start",
}: SelectContentProps) {
  const { open, setOpen, triggerRef } = useSelectContext();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 0,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  // Compute position relative to trigger button
  useEffect(() => {
    if (!open || !triggerRef.current) return;

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const top = rect.bottom + window.scrollY + 4;
      let left = rect.left + window.scrollX;

      if (align === "end") {
        left = rect.right + window.scrollX - rect.width;
      }

      setCoords({
        top,
        left,
        width: rect.width,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, align, triggerRef]);

  // Click outside and escape handling
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        contentRef.current &&
        !contentRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, setOpen, triggerRef]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      ref={contentRef}
      style={{
        position: "absolute",
        top: coords.top,
        left: coords.left,
        minWidth: Math.max(coords.width, 100),
      }}
      className={cn(
        "z-[9999] max-h-60 overflow-y-auto rounded-[8px] border border-[#e5e5e5] bg-white p-1 shadow-lg animate-in fade-in-50 zoom-in-95 duration-100",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface SelectItemProps {
  value: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export function SelectItem({
  value,
  disabled = false,
  className,
  children,
}: SelectItemProps) {
  const { value: selectedValue, onValueChange, setSelectedLabel } = useSelectContext();
  const isSelected = selectedValue === value;

  useEffect(() => {
    if (isSelected) {
      setSelectedLabel(children);
    }
  }, [isSelected, children, setSelectedLabel]);

  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      disabled={disabled}
      onClick={() => {
        if (!disabled) {
          onValueChange(value);
        }
      }}
      className={cn(
        "flex w-full items-center justify-between rounded-[6px] px-2.5 py-1.5 text-xs text-[#111111] transition-colors text-left",
        "hover:bg-[#fafafa] focus:bg-[#fafafa] focus:outline-none",
        isSelected && "bg-[#4a38f5]/5 font-medium text-[#4a38f5]",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <span className="truncate">{children}</span>
      {isSelected && <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-[#4a38f5]" />}
    </button>
  );
}
