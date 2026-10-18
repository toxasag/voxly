"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  ArrowRight,
  ExternalLink,
  KeyRound,
  Loader2,
  Mail,
  MessageCircle,
  Send,
} from "lucide-react";
import { loginWithCodeSchema, type LoginWithCodeValues } from "@/schemas/auth.schema";
import { cn } from "@/lib/utils";
import { useAuth, type AuthChannel } from "@/lib/auth/use-auth";
import { CHANNEL_LABEL, useCodeFlow } from "@/lib/auth/use-code-flow";
import { ApiClientError } from "@/lib/api/apiClient";
import { shouldRedirectToOwnPortal, tenantPortalUrl } from "@/lib/auth/tenant-host";
import { PasswordField } from "@/components/auth/PasswordField";

const CHANNELS: { value: AuthChannel; label: string; icon: typeof Send }[] = [
  { value: "telegram", label: "Telegram", icon: Send },
  { value: "max", label: "MAX", icon: MessageCircle },
];

const DEFAULT_REDIRECT = "/crm/contacts";

/**
 * Куда вести после входа.
 *
 * Только относительные пути: абсолютный или protocol-relative адрес в
 * `?redirect=` превратил бы параметр в open-redirect. `/login` исключён отдельно
 * — возврат на страницу входа и был причиной цикла.
 */
function resolveRedirect(): string {
  if (typeof window === "undefined") return DEFAULT_REDIRECT;

  const target = new URLSearchParams(window.location.search).get("redirect");

  if (
    target === null ||
    !target.startsWith("/") ||
    target.startsWith("//") ||
    target === "/login" ||
    target.startsWith("/login?") ||
    target.startsWith("/register")
  ) {
    return DEFAULT_REDIRECT;
  }

  return target;
}

/**
 * На платформенном хосте владельца переводим в его собственный портал.
 *
 * Условие вынесено в `shouldRedirectToOwnPortal`: там же учитывается, что на
 * localhost персональных хостов не бывает. Прежняя проверка
 * `currentTenantSlug() === tenantSlug` локально всегда расходилась, и после входа
 * страница уходила на `tenantPortalUrl`, который возвращал относительный путь —
 * то есть тот же адрес.
 */
function postLoginTarget(tenantSlug: string): string {
  const path = resolveRedirect();
  if (!shouldRedirectToOwnPortal(tenantSlug)) return path;
  return tenantPortalUrl(tenantSlug, path);
}

export function LoginForm() {
  const { loginWithCode, forgotPassword, tenant, isAuthenticated } = useAuth();
  const code = useCodeFlow("login");

  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Показывается только после отказа по паролю: до первой неудачи предлагать
  // восстановление незачем.
  const [showRecovery, setShowRecovery] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const otpInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<Omit<LoginWithCodeValues, "code">>({
    resolver: zodResolver(loginWithCodeSchema.omit({ code: true })),
    mode: "onChange",
    defaultValues: { email: "", password: "", channel: "telegram" },
  });

  const channel = form.watch("channel");
  const codeRequested = code.stage === "sent" || code.stage === "awaiting_bot";

  useEffect(() => {
    if (code.stage === "sent") otpInputRef.current?.focus();
  }, [code.stage]);

  /**
   * Уже авторизован — уводим со страницы входа.
   *
   * Middleware делает это на сервере, но cookie может отсутствовать, пока
   * сессия восстанавливается по refresh-токену: иначе пользователь остался бы
   * на /login с активной сессией.
   */
  useEffect(() => {
    if (!isAuthenticated || tenant === null) return;
    window.location.href = postLoginTarget(tenant.slug);
  }, [isAuthenticated, tenant]);

  const describeError = useCallback((error: unknown): string => {
    if (error instanceof ApiClientError) {
      if (error.isValidationError) {
        const fields = error.fieldErrors();
        return fields.email ?? fields.password ?? fields.code ?? fields._root ?? error.message;
      }
      switch (error.code) {
        case "UNAUTHORIZED":
          return error.message.includes("email") || error.message.includes("password")
            ? "Неверный e-mail или пароль"
            : error.message;
        case "OTP_ATTEMPTS_EXCEEDED":
          return "Слишком много попыток. Запросите новый код.";
        case "TENANT_INACTIVE":
          return "Доступ приостановлен: подписка компании неактивна";
        default:
          return error.message;
      }
    }
    return "Нет связи с сервером. Проверьте подключение и повторите попытку.";
  }, []);

  /** «Получить код»: e-mail и пароль обязательны до запроса кода. */
  const handleRequestCode = useCallback(async () => {
    const valid = await form.trigger();
    if (!valid) {
      toast.error("Укажите e-mail и пароль");
      return;
    }

    const values = form.getValues();
    setOtpError(null);

    // Телефон берётся с сервера по e-mail — пользователь его здесь не вводит.
    // Поэтому передаём e-mail, а номер резолвит backend.
    await code.request({ channel: values.channel, phone: "", email: values.email });
  }, [form, code]);

  /** Отправка ссылки восстановления на указанный в форме адрес. */
  const handleForgotPassword = useCallback(async () => {
    const emailValid = await form.trigger("email");
    if (!emailValid) {
      toast.error("Укажите e-mail, на который отправить ссылку");
      return;
    }

    setIsSendingReset(true);

    try {
      await forgotPassword(form.getValues().email);
      toast.success("Ссылка для восстановления пароля отправлена на ваш e-mail");
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setIsSendingReset(false);
    }
  }, [form, forgotPassword, describeError]);

  const handleSubmit = useCallback(async () => {
    if (code.sessionId === null) return;

    if (!/^\d{6}$/.test(otp)) {
      setOtpError("Код состоит из 6 цифр");
      return;
    }

    const values = form.getValues();
    setIsSubmitting(true);
    setOtpError(null);

    try {
      const session = await loginWithCode({
        email: values.email,
        password: values.password,
        session_id: code.sessionId,
        code: otp,
      });

      window.location.href = postLoginTarget(session.slug);
    } catch (error) {
      const message = describeError(error);

      // Ошибку пароля показываем на пароле, ошибку кода — на коде: иначе
      // пользователь не понимает, что именно исправлять. Отказ по паролю
      // дополнительно открывает восстановление доступа.
      const isCredentialError =
        error instanceof ApiClientError &&
        error.status === 401 &&
        (error.message.toLowerCase().includes("password") ||
          error.message.toLowerCase().includes("email"));

      if (isCredentialError) {
        form.setError("password", { message });
        setShowRecovery(true);
      } else {
        setOtpError(message);
      }

      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [code.sessionId, otp, form, loginWithCode, describeError]);

  const errors = form.formState.errors;
  const channelLabel = CHANNEL_LABEL[channel];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
      className="space-y-5"
    >
      {/* E-mail */}
      <div className="space-y-2">
        <label htmlFor="login_email" className="block text-sm font-medium text-slate-300">
          E-mail
        </label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            id="login_email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@company.ru"
            {...form.register("email")}
            className={cn(
              "w-full rounded-lg border bg-slate-900 py-3 pl-10 pr-4 text-sm text-slate-100 placeholder:text-slate-500 transition-colors",
              "focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
              errors.email !== undefined ? "border-rose-500" : "border-slate-700",
            )}
          />
        </div>
        {errors.email && <p className="text-xs text-rose-400">{errors.email.message}</p>}
      </div>

      {/* Пароль — с переключателем видимости и восстановлением доступа */}
      <PasswordField
        id="login_password"
        label="Пароль"
        autoComplete="current-password"
        placeholder="••••••••"
        error={errors.password?.message}
        {...form.register("password")}
        footer={
          showRecovery ? (
            <button
              type="button"
              onClick={() => void handleForgotPassword()}
              disabled={isSendingReset}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-lg border border-[#4a38f5]/40 bg-[#4a38f5]/10 px-4 py-2.5",
                "text-sm font-medium text-amber-400 transition-colors hover:bg-[#4a38f5]/20",
                "disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              {isSendingReset ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Отправляем ссылку...
                </>
              ) : (
                <>
                  <KeyRound className="h-4 w-4" />
                  Забыли пароль? Восстановить доступ
                </>
              )}
            </button>
          ) : null
        }
      />

      {/* Способ доставки одноразового кода */}
      <fieldset className="space-y-2">
        <legend className="block text-sm font-medium text-slate-300">
          Доставка одноразового кода
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {CHANNELS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => form.setValue("channel", value, { shouldValidate: true })}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors",
                channel === value
                  ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                  : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600 hover:text-slate-300",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          Код придёт в {channelLabel}. Если бот ещё не привязан, появится ссылка на подключение.
        </p>
      </fieldset>

      {!codeRequested && (
        <button
          type="button"
          onClick={() => void handleRequestCode()}
          disabled={code.stage === "requesting"}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold transition-colors",
            "bg-[#4a38f5] text-white hover:bg-[#3b2be0]",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {code.stage === "requesting" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Отправляем...
            </>
          ) : (
            <>
              Получить код
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      )}

      {/*
        Бот ещё не привязан. Вместо текста об ошибке — кликабельная ссылка на
        бота выбранного канала: до этого выбор MAX упирался в жёлтую надпись и
        отключённую кнопку, и подключиться было нечем.
      */}
      {code.stage === "awaiting_bot" && code.deepLink !== null && (
        <div className="space-y-3 rounded-lg border border-[#4a38f5]/30 bg-[#4a38f5]/5 p-4">
          <p className="text-sm text-slate-300">
            {CHANNEL_LABEL[code.channel]} не привязан к вашему аккаунту. Откройте бота{" "}
            <span className="font-medium text-amber-400">@{code.botUsername}</span> и нажмите
            «Start» — код придёт автоматически.
          </p>
          <a
            href={code.deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-lg bg-sky-500/10 px-4 py-2.5 text-sm font-medium text-sky-400 transition-colors hover:bg-sky-500/20"
          >
            <ExternalLink className="h-4 w-4" />
            Подключить {CHANNEL_LABEL[code.channel]} через @{code.botUsername}
          </a>
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            Ожидаем подтверждения из {CHANNEL_LABEL[code.channel]}...
          </p>
        </div>
      )}

      {code.stage === "sent" && (
        <div className="space-y-2">
          <label htmlFor="login_code" className="block text-sm font-medium text-slate-300">
            Код подтверждения
          </label>
          <input
            id="login_code"
            ref={otpInputRef}
            type="text"
            inputMode="numeric"
            maxLength={6}
            autoComplete="one-time-code"
            placeholder="------"
            value={otp}
            onChange={(e) => {
              setOtp(e.target.value.replace(/\D/g, "").slice(0, 6));
              setOtpError(null);
            }}
            className={cn(
              "w-full rounded-lg border bg-slate-900 py-4 text-center text-2xl tracking-[0.5em] text-slate-100 placeholder:text-slate-600 transition-colors",
              "focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
              otpError !== null ? "border-rose-500" : "border-slate-700",
            )}
          />
          {otpError !== null && <p className="text-center text-xs text-rose-400">{otpError}</p>}

          <div className="flex justify-end">
            {code.cooldown > 0 ? (
              <span className="text-xs text-slate-500">
                Отправить повторно через {code.cooldown} с
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void handleRequestCode()}
                className="text-xs font-medium text-[#4a38f5] hover:text-[#4a38f5]"
              >
                Отправить код повторно
              </button>
            )}
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting || code.stage !== "sent" || otp.length !== 6}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold transition-colors",
          "bg-[#4a38f5] text-white hover:bg-[#3b2be0]",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Входим...
          </>
        ) : (
          <>
            Войти
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>

      {/*
        Ссылка доступна всегда, а не только после ошибки: пользователь, который
        уже знает, что забыл пароль, не должен сначала получать отказ.
      */}
      {!showRecovery && (
        <p className="text-center text-sm text-slate-400">
          <button
            type="button"
            onClick={() => void handleForgotPassword()}
            disabled={isSendingReset}
            className="font-medium text-slate-400 underline-offset-2 transition-colors hover:text-[#4a38f5] hover:underline disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSendingReset ? "Отправляем ссылку..." : "Забыли пароль?"}
          </button>
        </p>
      )}

      <p className="text-center text-sm text-slate-400">
        Нет аккаунта?{" "}
        <a href="/register" className="font-medium text-[#4a38f5] hover:text-[#4a38f5]">
          Зарегистрировать компанию
        </a>
      </p>
    </form>
  );
}
