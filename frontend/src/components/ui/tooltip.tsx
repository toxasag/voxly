"use client";

import React, { useState, useRef, createContext, useContext } from "react";
import { cn } from "@/lib/utils";

interface TooltipContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const TooltipContext = createContext<TooltipContextType | null>(null);

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function Tooltip({
  children,
  delayDuration = 150,
}: {
  children: React.ReactNode;
  delayDuration?: number;
}) {
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleOpen = () => {
    timeoutRef.current = setTimeout(() => setOpen(true), delayDuration);
  };

  const handleClose = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(false);
  };

  return (
    <TooltipContext.Provider value={{ open, setOpen }}>
      <div
        className="relative inline-flex"
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
        onFocus={handleOpen}
        onBlur={handleClose}
      >
        {children}
      </div>
    </TooltipContext.Provider>
  );
}

export function TooltipTrigger({
  children,
  className,
  asChild,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }) {
  return (
    <div className={cn("inline-flex cursor-default", className)} {...props}>
      {children}
    </div>
  );
}

export function TooltipContent({
  children,
  className,
  side = "top",
  align = "center",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}) {
  const ctx = useContext(TooltipContext);
  if (!ctx?.open) return null;

  return (
    <div
      role="tooltip"
      className={cn(
        "pointer-events-none absolute z-50 max-w-xs rounded-[6px] border border-[#e5e5e5] bg-[#111111] px-2.5 py-1 text-xs text-white shadow-md transition-opacity duration-150 animate-in fade-in-0 zoom-in-95",
        side === "top" && "bottom-full mb-1.5",
        side === "bottom" && "top-full mt-1.5",
        side === "left" && "right-full mr-1.5",
        side === "right" && "left-full ml-1.5",
        align === "center" && (side === "top" || side === "bottom") && "left-1/2 -translate-x-1/2",
        align === "start" && (side === "top" || side === "bottom") && "left-0",
        align === "end" && (side === "top" || side === "bottom") && "right-0",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
