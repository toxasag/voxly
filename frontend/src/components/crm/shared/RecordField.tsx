"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronUp, ExternalLink, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const LABEL_WIDTH_PX = 120;

type FieldEditorKind = "text" | "email" | "url" | "number" | "date" | "select";

export interface RecordFieldSelectOption {
  value: string;
  label: string;
}

interface RecordFieldProps {
  icon: LucideIcon;
  label: string;
  value: string;
  display?: ReactNode;
  kind?: FieldEditorKind;
  options?: readonly RecordFieldSelectOption[];
  readOnly?: boolean;
  editing?: boolean;
  onStartEdit?: () => void;
  onCommit?: (value: string) => void;
  onCancel?: () => void;
  validate?: (value: string) => string | null;
  editor?: ReactNode;
}

export function RecordField({
  icon: Icon,
  label,
  value,
  display,
  kind = "text",
  options,
  readOnly = false,
  editing = false,
  onStartEdit,
  onCommit,
  onCancel,
  validate,
  editor,
}: RecordFieldProps) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (!editing) return;
    setDraft(value);
    setError(null);
    if (kind === "select") selectRef.current?.focus();
    else {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing, value, kind]);

  const commit = (next: string): void => {
    if (next === value) {
      onCancel?.();
      return;
    }
    const message = validate?.(next) ?? null;
    if (message !== null) {
      setError(message);
      return;
    }
    onCommit?.(next);
  };

  const isEmpty = value === "";

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 min-h-[30px]">
      <span
        className="flex shrink-0 items-center gap-2 text-xs text-[#666666]"
        style={{ width: LABEL_WIDTH_PX }}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-[#888888]" />
        <span className="truncate">{label}</span>
      </span>

      {editing ? (
        <div className="min-w-0 flex-1">
          {editor !== undefined ? editor : kind === "select" ? (
            <select
              ref={selectRef}
              value={draft}
              onChange={(event) => commit(event.target.value)}
              onBlur={() => onCancel?.()}
              onKeyDown={(event) => { if (event.key === "Escape") onCancel?.(); }}
              className="h-7 w-full rounded-[6px] border border-[#4a38f5] bg-white px-1.5 text-[13px] text-[#111111] outline-none"
            >
              {options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          ) : (
            <input
              ref={inputRef}
              value={draft}
              type={kind === "number" ? "number" : kind === "date" ? "date" : kind === "email" ? "email" : "text"}
              onChange={(event) => { setDraft(event.target.value); setError(null); }}
              onBlur={() => commit(draft)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit(draft);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  onCancel?.();
                }
              }}
              className={cn(
                "h-7 w-full min-w-0 rounded-[6px] border bg-white px-2 text-[13px] text-[#111111] outline-none",
                error === null ? "border-[#4a38f5]" : "border-rose-400",
              )}
            />
          )}
          {error !== null && <p className="mt-1 text-xs text-rose-500">{error}</p>}
        </div>
      ) : (
        <div
          role={readOnly ? undefined : "button"}
          tabIndex={readOnly ? undefined : 0}
          onClick={readOnly ? undefined : onStartEdit}
          onKeyDown={(event) => {
            if (!readOnly && event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              onStartEdit?.();
            }
          }}
          className={cn(
            "min-w-0 flex-1 rounded px-1.5 py-0.5 text-left text-[13px] transition-colors",
            readOnly ? "cursor-default text-[#666666]" : "cursor-pointer text-[#111111] hover:bg-black/[0.04]",
          )}
        >
          {isEmpty ? <span className="text-[#888888]">{readOnly ? "—" : label}</span> : <span className="block truncate">{display ?? value}</span>}
        </div>
      )}
    </div>
  );
}

interface RecordFieldGroupProps { title: string; children: ReactNode; defaultExpanded?: boolean; }

export function RecordFieldGroup({ title, children, defaultExpanded = true }: RecordFieldGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div className="mt-2">
      <button
        type="button"
        title={`Свернуть / развернуть секцию «${title}»`}
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-4 py-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
      >
        <span>{title}</span>
        <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !expanded && "rotate-180")} />
      </button>
      {expanded && <div className="space-y-0.5 py-0.5">{children}</div>}
    </div>
  );
}

export function RecordFieldLink({ href, label }: { href: string; label: string }) {
  return <a href={href} target="_blank" rel="noreferrer noopener" onClick={(event) => event.stopPropagation()} className="inline-flex min-w-0 items-center gap-1 text-[#4a38f5] hover:underline"><span className="truncate">{label}</span><ExternalLink className="h-3 w-3 shrink-0" /></a>;
}

interface RecordRelationSectionProps { title: string; count?: number; onSeeAll?: () => void; action?: ReactNode; children: ReactNode; }
export function RecordRelationSection({ title, count, onSeeAll, action, children }: RecordRelationSectionProps) {
  return (
    <div className="relative mt-4 border-t border-[#f0f0f0] pt-3 px-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-[#111111]">{title}</span>
          {count !== undefined && count > 0 && (
            <span className="rounded bg-[#f0f0f0] px-1.5 py-0.5 text-[11px] text-[#666666] font-normal">{count}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {action}
          {onSeeAll !== undefined && (
            <button
              type="button"
              onClick={onSeeAll}
              title={`Открыть все: ${title}`}
              className="rounded p-1 text-[#888888] transition-colors hover:bg-black/[0.04] hover:text-[#111111] cursor-pointer"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}
