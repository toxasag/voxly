"use client";

import { useEffect, useRef, useState } from "react";
import { Mail, Plus, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Список email-адресов контакта.
//
// Та же механика, что у PhonesInput и SocialsInput:
//  - первый email — основной, у него значок; у остальных кнопка «сделать основным»;
//  - строки добавляются и удаляются;
//  - валидация email-формата на лету;
//  - строки живут в собственном состоянии, а наружу уходят заполненные адреса.
// ---------------------------------------------------------------------------

interface EmailsInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  error?: string;
  idPrefix?: string;
}

interface EmailRow {
  id: string;
  value: string;
}

let rowCounter = 0;

function nextRowId(): string {
  rowCounter += 1;
  return `email-row-${rowCounter}`;
}

function toRows(emails: string[]): EmailRow[] {
  if (emails.length === 0) {
    return [{ id: nextRowId(), value: "" }];
  }
  return emails.map((val) => ({ id: nextRowId(), value: val }));
}

function toValue(rows: EmailRow[]): string[] {
  return rows
    .map((r) => r.value.trim())
    .filter((v) => v !== "");
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmailsInput({
  value,
  onChange,
  error,
  idPrefix = "emails",
}: EmailsInputProps) {
  const [rows, setRows] = useState<EmailRow[]>(() => toRows(value));
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Синхронизация при изменении входящего `value` извне
  const prevValueStr = useRef(JSON.stringify(value));
  useEffect(() => {
    const currentStr = JSON.stringify(value);
    if (currentStr !== prevValueStr.current) {
      prevValueStr.current = currentStr;
      setRows(toRows(value));
    }
  }, [value]);

  const commit = (nextRows: EmailRow[]) => {
    setRows(nextRows);
    const nextVal = toValue(nextRows);
    prevValueStr.current = JSON.stringify(nextVal);
    onChangeRef.current(nextVal);
  };

  const handleTextChange = (id: string, text: string) => {
    const next = rows.map((r) => (r.id === id ? { ...r, value: text } : r));
    commit(next);
  };

  const handleAdd = () => {
    const next = [...rows, { id: nextRowId(), value: "" }];
    commit(next);
  };

  const handleRemove = (id: string) => {
    if (rows.length <= 1) {
      commit([{ id: nextRowId(), value: "" }]);
      return;
    }
    const next = rows.filter((r) => r.id !== id);
    commit(next);
  };

  const handleMakePrimary = (id: string) => {
    const target = rows.find((r) => r.id === id);
    if (!target) return;
    const remaining = rows.filter((r) => r.id !== id);
    commit([target, ...remaining]);
  };

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {rows.map((row, index) => {
          const isPrimary = index === 0;
          const isInvalid = row.value.trim() !== "" && !EMAIL_REGEX.test(row.value.trim());

          return (
            <div key={row.id} className="flex items-center gap-1.5">
              <div
                className={cn(
                  "relative flex flex-1 items-center rounded-[6px] border bg-white transition-colors focus-within:border-[#4a38f5] focus-within:ring-1 focus-within:ring-[#4a38f5]/20",
                  isInvalid ? "border-rose-300" : "border-[#e5e5e5]",
                )}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center text-[#888888]">
                  <Mail className="h-3.5 w-3.5" />
                </div>

                <input
                  id={`${idPrefix}-${row.id}`}
                  type="email"
                  value={row.value}
                  placeholder={isPrimary ? "Основной e-mail" : "Дополнительный e-mail"}
                  onChange={(e) => handleTextChange(row.id, e.target.value)}
                  className="h-7 w-full min-w-0 bg-transparent pr-2 text-xs text-[#111111] placeholder:text-[#888888] outline-none"
                />

                {isPrimary ? (
                  <span
                    title="Основной e-mail"
                    className="mr-1.5 flex h-5 w-5 shrink-0 items-center justify-center text-amber-500"
                  >
                    <Star className="h-3.5 w-3.5 fill-current" />
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleMakePrimary(row.id)}
                    title="Сделать основным"
                    className="mr-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#888888] hover:bg-black/[0.04] hover:text-amber-500 transition-colors cursor-pointer"
                  >
                    <Star className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleRemove(row.id)}
                  title="Удалить email"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[#888888] hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-0.5">
        <button
          type="button"
          onClick={handleAdd}
          className="inline-flex items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 text-xs font-medium text-[#4a38f5] hover:bg-[#4a38f5]/10 transition-colors cursor-pointer"
        >
          <Plus className="h-3 w-3" />
          <span>Добавить email</span>
        </button>

        {error && <span className="text-xs text-rose-500">{error}</span>}
      </div>
    </div>
  );
}
