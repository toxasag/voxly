"use client";

import React, { type ComponentProps } from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export function Pagination({ className, ...props }: ComponentProps<"nav">) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      className={cn("flex w-full items-center justify-center", className)}
      {...props}
    />
  );
}

export function PaginationContent({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      className={cn("flex flex-row items-center gap-1 list-none p-0 m-0", className)}
      {...props}
    />
  );
}

export function PaginationItem({ className, ...props }: ComponentProps<"li">) {
  return <li className={cn("list-none", className)} {...props} />;
}

export interface PaginationLinkProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isActive?: boolean;
}

export function PaginationLink({
  className,
  isActive,
  disabled,
  children,
  ...props
}: PaginationLinkProps) {
  return (
    <button
      type="button"
      aria-current={isActive ? "page" : undefined}
      disabled={disabled}
      className={cn(
        "inline-flex h-8 min-w-8 items-center justify-center rounded-[6px] text-xs font-medium transition-colors select-none",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#4a38f5]",
        isActive
          ? "bg-[#4a38f5] text-white shadow-xs cursor-default"
          : "border border-[#e5e5e5] bg-white text-[#111111] hover:bg-[#fafafa] hover:border-[#cccccc] shadow-2xs",
        disabled && "opacity-40 cursor-not-allowed hover:bg-white hover:border-[#e5e5e5]",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function PaginationPrevious({
  className,
  ...props
}: ComponentProps<typeof PaginationLink>) {
  return (
    <PaginationLink
      aria-label="Предыдущая страница"
      className={cn("gap-1 px-2.5", className)}
      {...props}
    >
      <ChevronLeft className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Назад</span>
    </PaginationLink>
  );
}

export function PaginationNext({
  className,
  ...props
}: ComponentProps<typeof PaginationLink>) {
  return (
    <PaginationLink
      aria-label="Следующая страница"
      className={cn("gap-1 px-2.5", className)}
      {...props}
    >
      <span className="hidden sm:inline">Вперед</span>
      <ChevronRight className="h-3.5 w-3.5" />
    </PaginationLink>
  );
}

export function PaginationEllipsis({
  className,
  ...props
}: ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      className={cn("flex h-8 w-8 items-center justify-center text-[#888888]", className)}
      {...props}
    >
      <MoreHorizontal className="h-4 w-4" />
      <span className="sr-only">Больше страниц</span>
    </span>
  );
}
