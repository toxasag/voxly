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
  { bg: string; text: string; border: string; icon: LucideIcon }
> = {
  success: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
    icon: CheckCircle,
  },
  warning: {
    bg: "bg-[#4a38f5]/10",
    text: "text-amber-400",
    border: "border-[#4a38f5]/30",
    icon: AlertTriangle,
  },
  destructive: {
    bg: "bg-rose-500/10",
    text: "text-rose-400",
    border: "border-rose-500/30",
    icon: AlertCircle,
  },
  info: {
    bg: "bg-sky-500/10",
    text: "text-sky-400",
    border: "border-sky-500/30",
    icon: Info,
  },
  neutral: {
    bg: "bg-slate-500/10",
    text: "text-slate-400",
    border: "border-slate-500/30",
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
  const Icon = config.icon;

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
        <span className={cn("h-1.5 w-1.5 rounded-full", config.text.replace("text-", "bg-"))} />
      )}
      {children}
    </span>
  );
}