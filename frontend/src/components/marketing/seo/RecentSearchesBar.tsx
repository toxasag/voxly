"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RecentSearchItem } from "@/types/seo.types";

export interface RecentSearchesBarProps {
  searches: RecentSearchItem[];
  activeQuery: string;
  activeLocation?: string;
  onSelect: (search: RecentSearchItem) => void;
  onDelete: (id: string) => void;
}

export function RecentSearchesBar({
  searches,
  activeQuery,
  activeLocation,
  onSelect,
  onDelete,
}: RecentSearchesBarProps) {
  if (!searches || searches.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none text-[12px]">
      {searches.map((item) => {
        const isActive =
          item.query.toLowerCase() === activeQuery.toLowerCase() &&
          (!activeLocation || item.location.toLowerCase().includes(activeLocation.toLowerCase()));

        return (
          <div
            key={item.id}
            className={cn(
              "group flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors cursor-pointer select-none",
              isActive
                ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5] font-medium"
                : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
            )}
            onClick={() => onSelect(item)}
          >
            <span className="truncate max-w-[180px]">
              {item.query} <span className="opacity-60">· {item.location.split(",")[0]}</span>
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(item.id);
              }}
              className="rounded-full p-0.5 text-[#888888] hover:bg-black/5 hover:text-[#111111] transition-colors"
              title="Remove from recent"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
