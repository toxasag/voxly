"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowRight, Building2, CheckCircle2, Loader2, Phone, ShieldAlert } from "lucide-react";
import { acceptInviteSchema, type AcceptInviteValues } from "@/schemas/team.schema";
import { cn, formatPhone } from "@/lib/utils";
import { apiClient, ApiClientError } from "@/lib/api/apiClient";
import { PasswordField } from "@/components/auth/PasswordField";

interface InvitePreview {
  email: string;
  fullName: string;
  companyName: string;
  roleLabel: string;
}

/**
 * Принятие приглашения: сотрудник задаёт пароль и телефон.
 *
 * Данные приглашения загружаются до формы: человек должен видеть, в какую
 * компанию и с какой ролью его пригласили, прежде чем задавать пароль.
 */
export function AcceptInviteForm({ token }: { token: string | null }) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(token !== null);
  const [done, setDone] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<AcceptInviteValues>({
    resolver: zodResolver(acceptInviteSchema),
    mode: "onChange",
    defaultValues: { password: "", password_confirm: "", phone: "" },
  });

  useEffect(() => {
    if (token === null) return;

    let cancelled = false;

    void (async () => {
      try {
        const res = await apiClient.get<InvitePreview>(
          `/auth/invite?token=${encodeURIComponent(token)}`,
          { retrying: true },
        );
        if (!cancelled) setPreview(res.data);
      } catch (error) {
        if (cancelled) return;
        setLoadError(
          error instanceof ApiClientError
            ? error.message
            : "Не удалось проверить приглашение. Проверьте подключение.",
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = useCallback(
    async (values: AcceptInviteValues) => {
      if (token === null) return;

      setIsSubmitting(true);

      try {
        await apiClient.post(
          "/auth/invite/accept",
          { token, password: values.password, phone: values.phone },
          { retrying: true },
        );
        setDone(true);
        toast.success("Учётная запись активирована");
      } catch (error) {
        if (error instanceof ApiClientError) {
          const fields = error.fieldErrors();
          if (fields.phone !== undefined) {
            form.setError("phone", { message: fields.phone });
          } else if (fields.password !== undefined) {
            form.setError("password", { message: fields.password });
          } else {
            setLoadError(error.message);
          }
          toast.error(fields.phone ?? fields.password ?? error.message);
        } else {
          toast.error("Нет связи с сервером. Повторите попытку.");
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [token, form],
  );

  if (token === null) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/10">
          <ShieldAlert className="h-6 w-6 text-rose-400" />
        </div>
        <p className="text-sm text-slate-300">
          Ссылка неполная: в ней нет кода приглашения. Попросите администратора отправить новую.
        </p>
        <a
          href="/login"
          className="inline-flex items-center justify-center rounded-lg bg-[#4a38f5] px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#3b2be0]"
        >
          Перейти к входу
        </a>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Проверяем приглашение...
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
          Готово. Войдите по своему e-mail и новому паролю — код подтверждения придёт в бота.
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

  if (preview === null) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/10">
          <ShieldAlert className="h-6 w-6 text-rose-400" />
        </div>
        <p className="text-sm text-slate-300">
          {loadError ?? "Ссылка приглашения недействительна или устарела."}
        </p>
        <a
          href="/login"
          className="inline-flex items-center justify-center rounded-lg bg-[#4a38f5] px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#3b2be0]"
        >
          Перейти к входу
        </a>
      </div>
    );
  }

  const errors = form.formState.errors;

  return (
    <form onSubmit={form.handleSubmit((values) => void handleSubmit(values))} className="space-y-5">
      <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#4a38f5]/10">
            <Building2 className="h-4 w-4 text-amber-400" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-100">{preview.companyName}</p>
            <p className="text-xs text-slate-500">
              {preview.email} · {preview.roleLabel}
            </p>
          </div>
        </div>
      </div>

      <PasswordField
        id="invite_password"
        label="Пароль"
        autoComplete="new-password"
        autoFocus
        placeholder="••••••••"
        error={errors.password?.message}
        hint="Минимум 8 символов"
        {...form.register("password")}
      />

      <PasswordField
        id="invite_password_confirm"
        label="Повторите пароль"
        autoComplete="new-password"
        placeholder="••••••••"
        error={errors.password_confirm?.message}
        {...form.register("password_confirm")}
      />

      <div className="space-y-2">
        <label htmlFor="invite_phone" className="block text-sm font-medium text-slate-300">
          Телефон
        </label>
        <div className="relative">
          <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            id="invite_phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+7 999 123 45 67"
            value={form.watch("phone")}
            onChange={(event) =>
              form.setValue("phone", formatPhone(event.target.value), { shouldValidate: true })
            }
            className={cn(
              "w-full rounded-lg border bg-slate-900 py-3 pl-10 pr-4 text-sm text-slate-100 placeholder:text-slate-500 transition-colors",
              "focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
              errors.phone !== undefined ? "border-rose-500" : "border-slate-700",
            )}
          />
        </div>
        {errors.phone ? (
          <p className="text-xs text-rose-400">{errors.phone.message}</p>
        ) : (
          <p className="text-xs text-slate-500">На него придёт код подтверждения при входе</p>
        )}
      </div>

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
            Активируем...
          </>
        ) : (
          <>
            Начать работу
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
    </form>
  );
}
