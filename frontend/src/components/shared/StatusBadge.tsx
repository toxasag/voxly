"use client";

import type { ReactNode } from "react";
import {
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  Info,
  Circle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type StatusBadgeVariant = "success" | "warning" | "destructive" | "info" | "neutral";

interface StatusBadgeProps {
  variant: StatusBadgeVariant;
  children: ReactNode;
  className?: string;
  size?: "sm" | "md";
  withDot?: boolean;
}

const variantConfig: Record<
  StatusBadgeVariant,
  { bg: string; text: string; border: string; dot: string; icon: LucideIcon }
> = {
  success: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
    dot: "bg-emerald-600",
    icon: CheckCircle,
  },
  warning: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
    dot: "bg-amber-600",
    icon: AlertTriangle,
  },
  destructive: {
    bg: "bg-rose-50",
    text: "text-rose-700",
    border: "border-rose-200",
    dot: "bg-rose-600",
    icon: AlertCircle,
  },
  info: {
    bg: "bg-sky-50",
    text: "text-sky-700",
    border: "border-sky-200",
    dot: "bg-sky-600",
    icon: Info,
  },
  neutral: {
    bg: "bg-[#fafafa]",
    text: "text-[#666666]",
    border: "border-[#e5e5e5]",
    dot: "bg-[#888888]",
    icon: Circle,
  },
};

const sizeConfig: Record<"sm" | "md", string> = {
  sm: "px-2 py-0.5 text-xs gap-1",
  md: "px-2.5 py-0.5 text-xs gap-1.5",
};

export function StatusBadge({
  variant,
  children,
  className,
  size = "md",
  withDot = false,
}: StatusBadgeProps) {
  const config = variantConfig[variant];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium",
        config.bg,
        config.text,
        config.border,
        sizeConfig[size],
        className,
      )}
    >
      {withDot && (
        <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
      )}
      {children}
    </span>
  );
}