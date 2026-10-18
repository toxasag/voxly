"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Plus, Trash2 } from "lucide-react";
import type { ContactSocialInput, SocialKind } from "@/schemas/contact.schema";
import { SOCIAL_DEFINITIONS, socialDefinition } from "@/lib/crm/socials";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Список мессенджеров и соцсетей контакта.
//
// Та же механика, что у телефонов (у Twenty оба поля собраны на
// `MultiItemFieldInput`): строки добавляются и удаляются, значение — массив.
// Понятия «основной» здесь нет: у Twenty primary есть только у полей с
// composite-типом, а сети — независимые ссылки.
//
// Строки живут в собственном состоянии, а не выводятся из пропа `value`. Первая
// версия рендерила прямо из `value`, отбрасывая записи с пустым значением перед
// `onChange`, и из-за этого не работали две вещи: кнопка «Добавить сеть» ничего
// не добавляла (новая строка отбрасывалась фильтром), а выбор сети до ввода
// значения откатывался на Telegram. Наружу по-прежнему уходят только заполненные
// профили, но рендер от этого не зависит.
// ---------------------------------------------------------------------------

interface SocialsInputProps {
  value: ContactSocialInput[];
  onChange: (next: ContactSocialInput[]) => void;
  error?: string;
  idPrefix?: string;
}

interface SocialRow {
  id: string;
  kind: SocialKind;
  value: string;
}

let rowCounter = 0;

function nextRowId(): string {
  rowCounter += 1;
  return `social-${rowCounter}`;
}

function emptyRow(): SocialRow {
  return { id: nextRowId(), kind: "telegram", value: "" };
}

function toRows(socials: ContactSocialInput[]): SocialRow[] {
  return socials.length === 0
    ? [emptyRow()]
    : socials.map((entry) => ({ id: nextRowId(), kind: entry.kind, value: entry.value }));
}

function toValue(rows: SocialRow[]): ContactSocialInput[] {
  return rows
    .filter((row) => row.value.trim() !== "")
    .map((row) => ({ kind: row.kind, value: row.value }));
}

/** Сравнение по содержимому: `value` пересобирается при каждом рендере родителя. */
function sameEntries(rows: SocialRow[], socials: ContactSocialInput[]): boolean {
  const filled = rows.filter((row) => row.value.trim() !== "");
  if (filled.length !== socials.length) return false;

  return filled.every(
    (row, index) => row.kind === socials[index]?.kind && row.value === socials[index]?.value,
  );
}

export function SocialsInput({ value, onChange, error, idPrefix = "social" }: SocialsInputProps) {
  const [rows, setRows] = useState<SocialRow[]>(() => toRows(value));

  // Пересборка только при фактическом расхождении: иначе она стирала бы строку,
  // которую пользователь ещё заполняет.
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;

    setRows((current) => (sameEntries(current, value) ? current : toRows(value)));
  }, [value]);

  const apply = (next: SocialRow[]): void => {
    setRows(next);
    onChange(toValue(next));
  };

  const updateAt = (index: number, patch: Partial<SocialRow>): void => {
    apply(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  };

  const removeAt = (index: number): void => {
    const next = rows.filter((_, position) => position !== index);
    apply(next.length === 0 ? [emptyRow()] : next);
  };

  return (
    <div className="space-y-2">
      <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
        <MessageCircle className="h-3 w-3" /> Социальные сети
      </span>

      <div className="space-y-2">
        {rows.map((row, index) => {
          const definition = socialDefinition(row.kind);
          const showRemove = rows.length > 1 || row.value !== "";

          return (
            <div key={row.id} className="flex items-center gap-2">
              <select
                aria-label="Сеть"
                value={row.kind}
                onChange={(event) => updateAt(index, { kind: event.target.value as SocialKind })}
                className="w-[124px] shrink-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2.5 text-sm text-slate-100 focus:border-[#4a38f5] focus:outline-none"
              >
                {SOCIAL_DEFINITIONS.map((option) => (
                  <option key={option.kind} value={option.kind}>
                    {option.label}
                  </option>
                ))}
              </select>

              <input
                id={`${idPrefix}-${row.id}`}
                type="text"
                value={row.value}
                onChange={(event) => updateAt(index, { value: event.target.value })}
                placeholder={definition.placeholder}
                className={cn(
                  "min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
                )}
              />

              {showRemove && (
                <button
                  type="button"
                  onClick={() => removeAt(index)}
                  title="Удалить профиль"
                  aria-label="Удалить профиль"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-800 hover:text-rose-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {error !== undefined && <p className="text-xs text-rose-400">{error}</p>}

      <button
        type="button"
        onClick={() => apply([...rows, emptyRow()])}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800"
      >
        <Plus className="h-3.5 w-3.5" /> Добавить сеть
      </button>
    </div>
  );
}
