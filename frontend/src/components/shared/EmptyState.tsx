"use client";

import { type LucideIcon, PackageOpen } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon = PackageOpen,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 px-4 text-center",
        className,
      )}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#e5e5e5] bg-[#f5f5f5] mb-4">
        <Icon className="h-7 w-7 text-[#888888]" />
      </div>
      <h3 className="text-sm font-semibold text-[#111111]">{title}</h3>
      {description && (
        <p className="mt-1.5 text-sm text-[#666666] max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}