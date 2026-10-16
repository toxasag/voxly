"use client";

import { forwardRef, useId, useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Поле пароля с переключателем видимости.
//
// Общий компонент для всех трёх форм (вход, регистрация, сброс пароля): иначе
// логика переключения и одинаковая вёрстка дублировались бы, а показ пароля
// работал бы не везде.
//
// Реализовано через `forwardRef`, чтобы поле принимало результат
// `form.register("password")` из react-hook-form без обёрток: RHF передаёт `ref`
// вместе с `onChange`/`onBlur`/`name`.
// ---------------------------------------------------------------------------

interface PasswordFieldProps extends Omit<React.ComponentPropsWithoutRef<"input">, "type"> {
  label: string;
  /** Текст ошибки под полем; заодно включает красную рамку. */
  error?: string | undefined;
  /** Подсказка под полем, когда ошибки нет. */
  hint?: string | undefined;
  /** Дополнительный блок под полем — например ссылка «Забыли пароль?». */
  footer?: React.ReactNode;
}

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField({ label, error, hint, footer, className, id, ...inputProps }, ref) {
    const [visible, setVisible] = useState(false);
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    const errorId = `${fieldId}-error`;

    return (
      <div className="space-y-2">
        <label htmlFor={fieldId} className="block text-sm font-medium text-slate-300">
          {label}
        </label>

        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />

          <input
            {...inputProps}
            id={fieldId}
            ref={ref}
            type={visible ? "text" : "password"}
            aria-invalid={error !== undefined}
            aria-describedby={error !== undefined ? errorId : undefined}
            className={cn(
              "w-full rounded-lg border bg-slate-900 py-3 pl-10 pr-11 text-sm text-slate-100 placeholder:text-slate-500 transition-colors",
              "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
              error !== undefined ? "border-rose-500" : "border-slate-700",
              className,
            )}
          />

          {/*
            tabIndex={-1}: переключатель не должен вставать между полем пароля и
            кнопкой отправки при обходе формы с клавиатуры. Состояние
            озвучивается через aria-pressed, поэтому кнопка остаётся доступной
            для программ чтения экрана.
          */}
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setVisible((previous) => !previous)}
            aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
            aria-pressed={visible}
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition-colors hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {error !== undefined ? (
          <p id={errorId} className="text-xs text-rose-400">
            {error}
          </p>
        ) : hint !== undefined ? (
          <p className="text-xs text-slate-500">{hint}</p>
        ) : null}

        {footer}
      </div>
    );
  },
);
