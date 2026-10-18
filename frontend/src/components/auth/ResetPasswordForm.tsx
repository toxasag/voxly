"use client";

import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { resetPasswordSchema, type ResetPasswordValues } from "@/schemas/auth.schema";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/use-auth";
import { ApiClientError } from "@/lib/api/apiClient";
import { PasswordField } from "@/components/auth/PasswordField";

/**
 * Смена пароля по ссылке из письма.
 *
 * Токен принимается пропом, а не читается здесь из `location`: страница —
 * серверный компонент с `searchParams`, и разбор в одном месте исключает
 * расхождение между тем, что проверено, и тем, что отправлено.
 */
export function ResetPasswordForm({ token }: { token: string | null }) {
  const { resetPassword } = useAuth();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    mode: "onChange",
    defaultValues: { password: "", password_confirm: "" },
  });

  const describeError = useCallback((error: unknown): string => {
    if (error instanceof ApiClientError) {
      if (error.isValidationError) {
        const fields = error.fieldErrors();
        return fields.password ?? fields.token ?? fields._root ?? error.message;
      }
      if (error.code === "INVALID_RESET_TOKEN") {
        return "Ссылка недействительна или устарела. Запросите восстановление пароля заново.";
      }
      return error.message;
    }
    return "Нет связи с сервером. Проверьте подключение и повторите попытку.";
  }, []);

  const handleSubmit = useCallback(
    async (values: ResetPasswordValues) => {
      if (token === null) return;

      setIsSubmitting(true);

      try {
        await resetPassword({ token, password: values.password });
        setDone(true);
        toast.success("Пароль обновлён. Войдите с новым паролем.");
      } catch (error) {
        const message = describeError(error);
        form.setError("password", { message });
        toast.error(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [token, resetPassword, form, describeError],
  );

  // Ссылка без токена: показываем это сразу, а не после отправки формы.
  if (token === null) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/10">
          <ShieldAlert className="h-6 w-6 text-rose-400" />
        </div>
        <p className="text-sm text-slate-300">
          Ссылка неполная: в ней нет кода восстановления. Запросите восстановление пароля заново.
        </p>
        <a
          href="/login"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#4a38f5] px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#3b2be0]"
        >
          Вернуться к входу
        </a>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10">
          <CheckCircle2 className="h-6 w-6 text-emerald-400" />
        </div>
        <p className="text-sm text-slate-300">
          Пароль обновлён. Все прежние сессии завершены — войдите заново.
        </p>
        <a
          href="/login"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#4a38f5] px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#3b2be0]"
        >
          Войти
          <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    );
  }

  const errors = form.formState.errors;

  return (
    <form
      onSubmit={form.handleSubmit((values) => void handleSubmit(values))}
      className="space-y-5"
    >
      <PasswordField
        id="reset_password"
        label="Новый пароль"
        autoComplete="new-password"
        autoFocus
        placeholder="••••••••"
        error={errors.password?.message}
        hint="Минимум 8 символов"
        {...form.register("password")}
      />

      <PasswordField
        id="reset_password_confirm"
        label="Повторите новый пароль"
        autoComplete="new-password"
        placeholder="••••••••"
        error={errors.password_confirm?.message}
        {...form.register("password_confirm")}
      />

      <button
        type="submit"
        disabled={isSubmitting}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold transition-colors",
          "bg-[#4a38f5] text-white hover:bg-[#3b2be0]",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Сохраняем...
          </>
        ) : (
          <>
            Сохранить новый пароль
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>

      <p className="text-center text-sm text-slate-400">
        Вспомнили пароль?{" "}
        <a href="/login" className="font-medium text-[#4a38f5] hover:text-[#4a38f5]">
          Войти
        </a>
      </p>
    </form>
  );
}
