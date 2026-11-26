"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import { Check, ChevronDown, Plus, Loader2, X } from "lucide-react";
import { cn, matchesSearchTokens } from "@/lib/utils";

export interface CreatableComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  createLabelPrefix?: string;
  onCreateOption?: (name: string) => Promise<string | void> | void;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
}

export function CreatableCombobox({
  value,
  onChange,
  options = [],
  placeholder = "Выберите или введите...",
  createLabelPrefix = "Создать",
  onCreateOption,
  disabled = false,
  className,
  autoFocus = false,
}: CreatableComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync internal query with external value when dropdown is closed
  useEffect(() => {
    if (!isOpen) {
      setQuery(value || "");
    }
  }, [value, isOpen]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        // Reset query back to selected value if user didn't pick anything
        setQuery(value || "");
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, value]);

  // Filter options based on query
  const filteredOptions = useMemo(() => {
    return options.filter((opt) => matchesSearchTokens(query, [opt]));
  }, [options, query]);

  // Check if query exactly matches an existing option
  const exactMatch = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.some((opt) => opt.trim().toLowerCase() === q);
  }, [options, query]);

  const canCreate = Boolean(
    onCreateOption && query.trim().length > 0 && !exactMatch,
  );

  const handleSelect = (selected: string) => {
    onChange(selected);
    setQuery(selected);
    setIsOpen(false);
  };

  const handleCreate = async () => {
    const trimmed = query.trim();
    if (!trimmed || isCreating) return;

    if (onCreateOption) {
      try {
        setIsCreating(true);
        const result = await onCreateOption(trimmed);
        const finalValue = typeof result === "string" ? result : trimmed;
        onChange(finalValue);
        setQuery(finalValue);
        setIsOpen(false);
      } catch {
        // error handling handled by caller's toast
      } finally {
        setIsCreating(false);
      }
    } else {
      onChange(trimmed);
      setQuery(trimmed);
      setIsOpen(false);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
    setQuery("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setIsOpen(false);
      setQuery(value || "");
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredOptions.length > 0 && !exactMatch) {
        handleSelect(filteredOptions[0]);
      } else if (canCreate) {
        void handleCreate();
      }
    } else if (e.key === "ArrowDown") {
      if (!isOpen) setIsOpen(true);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          disabled={disabled}
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => {
            if (!disabled) setIsOpen(true);
          }}
          placeholder={placeholder}
          onKeyDown={handleKeyDown}
          className={cn(
            "h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 pr-14 text-[13px] text-[#111111]",
            "placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
            "transition-colors",
            disabled && "cursor-not-allowed bg-[#fafafa] text-[#888888]",
          )}
        />
        <div className="absolute right-1.5 flex items-center gap-1">
          {value && !disabled && (
            <button
              type="button"
              tabIndex={-1}
              onClick={handleClear}
              className="rounded p-0.5 text-[#888888] hover:bg-[#fafafa] hover:text-[#111111] transition-colors"
              title="Очистить"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onClick={() => {
              if (!disabled) {
                setIsOpen((prev) => !prev);
                inputRef.current?.focus();
              }
            }}
            className="rounded p-0.5 text-[#888888] hover:bg-[#fafafa] hover:text-[#111111] transition-colors"
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform duration-150",
                isOpen && "rotate-180",
              )}
            />
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-[8px] border border-[#e5e5e5] bg-white p-1 shadow-lg animate-in fade-in-50 zoom-in-95 duration-100">
          {canCreate && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                void handleCreate();
              }}
              disabled={isCreating}
              className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-xs font-medium text-[#4a38f5] hover:bg-[#4a38f5]/10 transition-colors text-left"
            >
              {isCreating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              <span className="truncate">
                {createLabelPrefix} «{query.trim()}»
              </span>
            </button>
          )}

          {filteredOptions.length > 0 ? (
            <div className={cn("space-y-0.5", canCreate && "mt-1 pt-1 border-t border-[#f0f0f0]")}>
              {filteredOptions.map((opt) => {
                const isSelected = opt.toLowerCase() === value.trim().toLowerCase();
                return (
                  <button
                    key={opt}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelect(opt);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-[6px] px-2.5 py-1.5 text-xs text-[#111111] hover:bg-[#fafafa] transition-colors text-left",
                      isSelected && "bg-[#4a38f5]/5 font-medium text-[#4a38f5]",
                    )}
                  >
                    <span className="truncate">{opt}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 text-[#4a38f5] shrink-0" />}
                  </button>
                );
              })}
            </div>
          ) : !canCreate ? (
            <div className="px-2.5 py-2 text-center text-xs text-[#888888]">
              Ничего не найдено
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
