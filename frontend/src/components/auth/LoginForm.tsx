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
  if (path.startsWith("/admin") || path.startsWith("/superadmin")) {
    return path;
  }
  if (!shouldRedirectToOwnPortal(tenantSlug)) return path;
  return tenantPortalUrl(tenantSlug, path);
}

export function LoginForm() {
  const { login, loginWithCode, forgotPassword, tenant, isAuthenticated } = useAuth();
  const code = useCodeFlow("login");

  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
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

  /** «Войти»: проверяем пароль, если 2FA не требуется — входим сразу, иначе запрашиваем код. */
  const handleRequestCode = useCallback(async () => {
    const valid = await form.trigger();
    if (!valid) {
      toast.error("Укажите e-mail и пароль");
      return;
    }

    const values = form.getValues();
    setOtpError(null);
    setIsLoggingIn(true);

    try {
      const session = await login(values.email, values.password);
      window.location.href = postLoginTarget(session.slug);
      return;
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === "SECOND_FACTOR_REQUIRED") {
          // Телефон берётся с сервера по e-mail — пользователь его здесь не вводит.
          // Поэтому передаём e-mail, а номер резолвит backend.
          await code.request({ channel: values.channel, phone: "", email: values.email });
          return;
        }

        const message = describeError(err);
        const isCredentialError =
          err.status === 401 &&
          (err.message.toLowerCase().includes("password") ||
            err.message.toLowerCase().includes("email") ||
            err.code === "UNAUTHORIZED");

        if (isCredentialError) {
          form.setError("password", { message });
          setShowRecovery(true);
        }
        toast.error(message);
        return;
      }
      toast.error(describeError(err));
    } finally {
      setIsLoggingIn(false);
    }
  }, [form, code, login, describeError]);

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
        if (codeRequested) {
          void handleSubmit();
        } else {
          void handleRequestCode();
        }
      }}
      className="space-y-4"
    >
      {/* E-mail */}
      <div className="space-y-2">
        <label htmlFor="login_email" className="block text-[13px] font-medium text-[#111111]">
          E-mail
        </label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#888888]" />
          <input
            id="login_email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@company.ru"
            {...form.register("email")}
            className={cn(
              "w-full rounded-[8px] border bg-white py-2.5 pl-10 pr-4 text-[13px] text-[#111111] placeholder:text-[#888888] transition-colors",
              "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
              errors.email !== undefined ? "border-rose-500" : "border-[#e5e5e5]",
            )}
          />
        </div>
        {errors.email && <p className="text-xs text-rose-600">{errors.email.message}</p>}
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
                "flex w-full items-center justify-center gap-2 rounded-[8px] border border-[#4a38f5]/30 bg-[#4a38f5]/5 px-4 py-2.5",
                "text-[13px] font-medium text-[#4a38f5] transition-colors hover:bg-[#4a38f5]/10",
                "disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              {isSendingReset ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-[#666666]" />
                  Отправляем ссылку...
                </>
              ) : (
                <>
                  <KeyRound className="h-4 w-4 text-[#4a38f5]" />
                  Забыли пароль? Восстановить доступ
                </>
              )}
            </button>
          ) : null
        }
      />

      {/* Способ доставки одноразового кода */}
      <fieldset className="space-y-2">
        <legend className="block text-[13px] font-medium text-[#111111]">
          Доставка одноразового кода
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {CHANNELS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => form.setValue("channel", value, { shouldValidate: true })}
              className={cn(
                "flex items-center justify-center gap-2 rounded-[8px] border px-4 py-2.5 text-[13px] font-medium transition-colors",
                channel === value
                  ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                  : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-[#666666]">
          Код придёт в {channelLabel}. Если бот ещё не привязан, появится ссылка на подключение.
        </p>
      </fieldset>

      {!codeRequested && (
        <button
          type="button"
          onClick={() => void handleRequestCode()}
          disabled={code.stage === "requesting" || isLoggingIn}
          className={cn(
            "flex h-10 w-full items-center justify-center gap-2 rounded-[8px] text-[13px] font-medium transition-colors shadow-2xs",
            "bg-[#4a38f5] text-white hover:bg-[#3d2ee0]",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {code.stage === "requesting" || isLoggingIn ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Вход...
            </>
          ) : (
            <>
              Войти
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
      {code.error !== null && code.stage === "idle" && (
        <p role="alert" className="rounded-[8px] border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          {code.error}
        </p>
      )}

      {code.stage === "awaiting_bot" && code.deepLink !== null && (
        <div className="space-y-3 rounded-[8px] border border-[#4a38f5]/20 bg-[#4a38f5]/5 p-4">
          <p className="text-[13px] text-[#111111]">
            {CHANNEL_LABEL[code.channel]} не привязан к вашему аккаунту. Откройте бота{" "}
            <span className="font-semibold text-[#4a38f5]">@{code.botUsername}</span> и нажмите
            «Start» — код придёт автоматически.
          </p>
          <a
            href={code.deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-[8px] bg-[#4a38f5]/10 px-4 py-2.5 text-[13px] font-medium text-[#4a38f5] transition-colors hover:bg-[#4a38f5]/15"
          >
            <ExternalLink className="h-4 w-4" />
            Подключить {CHANNEL_LABEL[code.channel]} через @{code.botUsername}
          </a>
          <p className="flex items-center gap-2 text-xs text-[#666666]">
            <Loader2 className="h-3 w-3 animate-spin text-[#4a38f5]" />
            Ожидаем подтверждения из {CHANNEL_LABEL[code.channel]}...
          </p>
        </div>
      )}

      {code.stage === "sent" && (
        <div className="space-y-2">
          <label htmlFor="login_code" className="block text-[13px] font-medium text-[#111111]">
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
              "w-full rounded-[8px] border bg-white py-3 text-center font-mono text-2xl tracking-[0.5em] text-[#111111] placeholder:text-[#cccccc] transition-colors tabular-nums",
              "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
              otpError !== null ? "border-rose-500" : "border-[#e5e5e5]",
            )}
          />
          {otpError !== null && <p className="text-center text-xs text-rose-600">{otpError}</p>}

          <div className="flex justify-end">
            {code.cooldown > 0 ? (
              <span className="text-xs text-[#666666]">
                Отправить повторно через {code.cooldown} с
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void handleRequestCode()}
                className="text-xs font-medium text-[#4a38f5] hover:underline"
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
          "flex h-10 w-full items-center justify-center gap-2 rounded-[8px] text-[13px] font-medium transition-colors shadow-2xs",
          "bg-[#4a38f5] text-white hover:bg-[#3d2ee0]",
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
        <p className="text-center text-[13px] text-[#666666]">
          <button
            type="button"
            onClick={() => void handleForgotPassword()}
            disabled={isSendingReset}
            className="font-medium text-[#666666] underline-offset-2 transition-colors hover:text-[#4a38f5] hover:underline disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSendingReset ? "Отправляем ссылку..." : "Забыли пароль?"}
          </button>
        </p>
      )}

      <p className="text-center text-[13px] text-[#666666]">
        Нет аккаунта?{" "}
        <a href="/register" className="font-medium text-[#4a38f5] hover:underline">
          Зарегистрировать компанию
        </a>
      </p>
    </form>
  );
}
