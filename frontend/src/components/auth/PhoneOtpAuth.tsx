"use client";

import { useState, useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Phone,
  MessageCircle,
  Hash,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Timer,
  ShieldCheck,
  RefreshCw,
  Mail,
  Smartphone,
} from "lucide-react";
import {
  phoneSchema,
  otpSchema,
  emailLoginSchema,
  type PhoneFormValues,
  type OtpFormValues,
  type EmailLoginValues,
} from "@/schemas/auth.schema";
import { toast } from "sonner";
import { cn, formatPhone } from "@/lib/utils";
import type { AuthStep, OtpChannel, OtpState } from "@/lib/auth/types";
import { getChannelLabel } from "@/lib/auth/types";
import { useAuth } from "@/lib/auth/use-auth";
import { ApiClientError } from "@/lib/api/apiClient";
import { shouldRedirectToOwnPortal, tenantPortalUrl } from "@/lib/auth/tenant-host";

const CHANNELS: { value: OtpChannel; icon: typeof MessageCircle }[] = [
  { value: "telegram", icon: MessageCircle },
  { value: "whatsapp", icon: MessageCircle },
  { value: "rumax", icon: Hash },
  { value: "sms", icon: Smartphone },
];

const OTP_LENGTH = 6;
/** Resend cooldown. The code's own validity is set by the backend (OTP_TTL_MINUTES). */
const RESEND_COOLDOWN_SECONDS = 60;

/** Post-login destination. `/crm/contacts` is the real route ( `/contacts` does not exist). */
const DEFAULT_REDIRECT = "/crm/contacts";

function resolveRedirect(): string {
  if (typeof window === "undefined") return DEFAULT_REDIRECT;

  const target = new URLSearchParams(window.location.search).get("redirect");

  // Only same-site absolute paths: a protocol-relative or absolute URL here
  // would turn the redirect param into an open-redirect. `/login` is excluded
  // too — bouncing back to the sign-in page is the loop being fixed.
  if (
    target === null ||
    !target.startsWith("/") ||
    target.startsWith("//") ||
    target === "/login" ||
    target.startsWith("/login?")
  ) {
    return DEFAULT_REDIRECT;
  }

  return target;
}

/**
 * Where to send the user after signing in.
 *
 * On a platform host (app.getvoxly.ru) the owner is moved to their own portal,
 * so the address bar reflects the tenant they actually work in. On the correct
 * tenant subdomain already, the in-page path is kept.
 *
 * Условие вынесено в `shouldRedirectToOwnPortal`: оно дополнительно учитывает
 * окружения без персональных хостов (localhost, IP-адрес), где `tenantPortalUrl`
 * возвращает относительный путь и «переход» ведёт на ту же страницу
 * (`M0.13.15`).
 */
function postLoginTarget(tenantSlug: string): string {
  const path = resolveRedirect();
  if (!shouldRedirectToOwnPortal(tenantSlug)) return path;
  return tenantPortalUrl(tenantSlug, path);
}

export function PhoneOtpAuth() {
  const { sendOtp, loginWithOtp, login, tenant, isAuthenticated } = useAuth();

  const [authStep, setAuthStep] = useState<AuthStep>("phone");
  const [otp, setOtp] = useState<OtpState | null>(null);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [timer, setTimer] = useState(0);

  const phoneForm = useForm<PhoneFormValues>({
    resolver: zodResolver(phoneSchema),
    defaultValues: { phone: "+7 ", channel: "telegram" },
    mode: "onChange",
  });

  const otpForm = useForm<OtpFormValues>({
    resolver: zodResolver(otpSchema),
    defaultValues: { code: "" },
  });

  const emailForm = useForm<EmailLoginValues>({
    resolver: zodResolver(emailLoginSchema),
    defaultValues: { email: "", password: "" },
  });

  const startTimer = useCallback(() => {
    setTimer(RESEND_COOLDOWN_SECONDS);
    const interval = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  /**
   * Maps a backend failure onto a message the user can act on.
   *
   * Server codes are translated explicitly rather than shown raw: the backend
   * answers in English, and `Invalid email or password` told a Russian-speaking
   * user nothing while the form appeared to simply reload.
   */
  const describeError = useCallback((error: unknown): string => {
    if (error instanceof ApiClientError) {
      if (error.isValidationError) {
        const fields = error.fieldErrors();
        return (
          fields.phone ?? fields.code ?? fields.email ?? fields.password ?? fields._root ?? error.message
        );
      }

      switch (error.code) {
        case "UNAUTHORIZED":
          return "Неверный e-mail или пароль";
        case "OTP_ATTEMPTS_EXCEEDED":
          return "Слишком много попыток. Запросите новый код";
        case "TENANT_INACTIVE":
          return "Доступ приостановлен: подписка компании неактивна";
        case "TOO_MANY_REQUESTS":
          return "Слишком много запросов. Попробуйте через минуту";
        default:
          return error.message;
      }
    }

    return "Нет связи с сервером. Проверьте подключение и повторите попытку";
  }, []);

  /** Shows the failure both on the field and as a toast, never silently. */
  const reportError = useCallback(
    (error: unknown, apply: (message: string) => void): void => {
      const message = describeError(error);
      apply(message);
      toast.error(message);
    },
    [describeError],
  );

  /**
   * Bounces an already-signed-in visitor off the sign-in page.
   *
   * The middleware does this server-side, but the cookie can be absent while a
   * valid refresh token restores the session client-side (a browser restart
   * clears a session cookie). Without this the user would sit on /login with an
   * active session.
   */
  useEffect(() => {
    if (!isAuthenticated || tenant === null) return;
    window.location.href = postLoginTarget(tenant.slug);
  }, [isAuthenticated, tenant]);

  const handleSendOtp = useCallback(
    async (values: PhoneFormValues) => {
      setIsSendingOtp(true);
      try {
        const result = await sendOtp(values.phone);

        setOtp({
          phone: values.phone,
          channel: values.channel,
          expiresAt: Date.now() + result.expires_in_minutes * 60_000,
        });
        setAuthStep("otp");
        startTimer();
        toast.success(`Код отправлен через ${getChannelLabel(values.channel)}`);
      } catch (error) {
        reportError(error, (message) => phoneForm.setError("phone", { message }));
      } finally {
        setIsSendingOtp(false);
      }
    },
    [sendOtp, startTimer, phoneForm, reportError],
  );

  const handleVerifyOtp = useCallback(
    async (values: OtpFormValues) => {
      if (otp === null) return;

      setIsVerifying(true);
      try {
        const session = await loginWithOtp(otp.phone, values.code);
        window.location.href = postLoginTarget(session.slug);
      } catch (error) {
        reportError(error, (message) => otpForm.setError("code", { message }));
        // Cleared only on failure: leaving the rejected code in place makes the
        // user delete six characters before retrying.
        otpForm.setValue("code", "");
      } finally {
        setIsVerifying(false);
      }
    },
    [otp, loginWithOtp, otpForm, reportError],
  );

  const handleResendOtp = useCallback(async () => {
    if (otp === null) return;

    setIsSendingOtp(true);
    try {
      const result = await sendOtp(otp.phone);
      setOtp((prev) =>
        prev === null
          ? prev
          : { ...prev, expiresAt: Date.now() + result.expires_in_minutes * 60_000 },
      );
      otpForm.clearErrors("code");
      startTimer();
      toast.success("Новый код отправлен");
    } catch (error) {
      reportError(error, (message) => otpForm.setError("code", { message }));
    } finally {
      setIsSendingOtp(false);
    }
  }, [otp, sendOtp, startTimer, otpForm, reportError]);

  const handleEmailSubmit = useCallback(
    async (values: EmailLoginValues) => {
      setIsSigningIn(true);
      try {
        const session = await login(values.email, values.password);
        window.location.href = postLoginTarget(session.slug);
      } catch (error) {
        reportError(error, (message) => emailForm.setError("password", { message }));
      } finally {
        setIsSigningIn(false);
      }
    },
    [login, emailForm, reportError],
  );

  const handleBackToPhone = useCallback(() => {
    setAuthStep("phone");
    setOtp(null);
    setTimer(0);
    otpForm.reset();
  }, [otpForm]);

  const handlePhoneInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const formatted = formatPhone(e.target.value);
      phoneForm.setValue("phone", formatted, { shouldValidate: true });
    },
    [phoneForm],
  );

  const { watch: watchPhone, formState: phoneFormState } = phoneForm;
  const phoneValue = watchPhone("phone");

  const formatTimer = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Tabs */}
      <div className="mb-6 flex rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-1">
        <button
          type="button"
          onClick={() => setAuthStep("phone")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-[6px] px-3 py-2 text-[13px] font-medium transition-colors",
            authStep === "phone" || authStep === "otp"
              ? "bg-[#4a38f5] text-white"
              : "text-[#666666] hover:text-[#111111]",
          )}
        >
          <Smartphone className="h-4 w-4" />
          Вход по телефону
        </button>
        <button
          type="button"
          onClick={() => setAuthStep("email")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-[6px] px-3 py-2 text-[13px] font-medium transition-colors",
            authStep === "email"
              ? "bg-[#4a38f5] text-white"
              : "text-[#666666] hover:text-[#111111]",
          )}
        >
          <Mail className="h-4 w-4" />
          Email
        </button>
      </div>

      {/* Step 1 — Phone + Channel */}
      {(authStep === "phone" || authStep === "otp") && (
        <form
          onSubmit={phoneForm.handleSubmit(handleSendOtp)}
          className="space-y-6"
        >
          {authStep === "phone" && (
            <>
              <div className="space-y-2">
                <label
                  htmlFor="phone"
                  className="block text-[13px] font-medium text-[#111111]"
                >
                  Номер телефона
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#888888]" />
                  <input
                    id="phone"
                    type="tel"
                    value={phoneValue}
                    onChange={handlePhoneInput}
                    placeholder="+7 999 999 99 99"
                    autoComplete="tel"
                    autoFocus
                    className={cn(
                      "w-full rounded-[8px] border bg-white py-2.5 pl-10 pr-4 text-[13px] text-[#111111] placeholder:text-[#888888] transition-colors",
                      "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                      phoneFormState.errors.phone
                        ? "border-rose-500"
                        : "border-[#e5e5e5]",
                    )}
                  />
                </div>
                {phoneFormState.errors.phone && (
                  <p className="text-xs text-rose-600">
                    {phoneFormState.errors.phone.message}
                  </p>
                )}
              </div>

              <fieldset className="space-y-2">
                <legend className="block text-[13px] font-medium text-[#111111]">
                  Способ доставки кода
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  {CHANNELS.map(({ value, icon: Icon }) => {
                    const isSelected = phoneForm.watch("channel") === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          phoneForm.setValue("channel", value, {
                            shouldValidate: true,
                          })
                        }
                        className={cn(
                          "flex items-center gap-2 rounded-[8px] border px-4 py-2.5 text-[13px] font-medium transition-colors",
                          isSelected
                            ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                            : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {getChannelLabel(value)}
                      </button>
                    );
                  })}
                </div>
                {phoneFormState.errors.channel && (
                  <p className="text-xs text-rose-600">
                    {phoneFormState.errors.channel.message}
                  </p>
                )}
              </fieldset>

              <button
                type="submit"
                disabled={isSendingOtp || !phoneFormState.isValid}
                className={cn(
                  "flex h-10 w-full items-center justify-center gap-2 rounded-[8px] text-[13px] font-medium transition-colors",
                  "bg-[#4a38f5] text-white hover:bg-[#3d2ee0]",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                {isSendingOtp ? (
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
            </>
          )}

          {authStep === "otp" && otp && (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleBackToPhone}
                  className="flex items-center gap-1 text-[13px] text-[#666666] transition-colors hover:text-[#111111]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Назад
                </button>
                <div className="flex-1" />
                <div className="flex items-center gap-2 rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] px-3 py-1.5 text-xs text-[#666666]">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#4a38f5]" />
                  Код отправлен на {otp.phone} через{" "}
                  {getChannelLabel(otp.channel)}
                </div>
              </div>

              <div className="space-y-2 text-center">
                <h2 className="text-base font-semibold text-[#111111]">
                  Введите код подтверждения
                </h2>
                <p className="text-[13px] text-[#666666]">
                  Мы отправили 6-значный код{" "}
                  {otp.channel === "sms" ? "по SMS" : `в ${getChannelLabel(otp.channel)}`}
                </p>
              </div>

              <div className="space-y-1">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={OTP_LENGTH}
                  autoComplete="one-time-code"
                  autoFocus
                  value={otpForm.watch("code")}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "").slice(
                      0,
                      OTP_LENGTH,
                    );
                    otpForm.setValue("code", val, { shouldValidate: true });
                  }}
                  className={cn(
                    "w-full rounded-[8px] border bg-white py-3 text-center text-2xl tracking-[0.5em] text-[#111111] placeholder:text-[#cccccc] transition-colors",
                    "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                    otpForm.formState.errors.code
                      ? "border-rose-500"
                      : "border-[#e5e5e5]",
                  )}
                  placeholder="------"
                />
                {otpForm.formState.errors.code && (
                  <p className="text-center text-xs text-rose-600">
                    {otpForm.formState.errors.code.message}
                  </p>
                )}
              </div>

              {/*
                Not gated on `timer`: that is the resend cooldown, whereas the
                code stays valid for OTP_TTL_MINUTES (5 by default). Expiry is
                enforced by the backend, which answers with a clear message.
              */}
              <button
                type="button"
                onClick={otpForm.handleSubmit(handleVerifyOtp)}
                disabled={isVerifying || !otpForm.formState.isValid}
                className={cn(
                  "flex h-10 w-full items-center justify-center gap-2 rounded-[8px] text-[13px] font-medium transition-colors",
                  "bg-[#4a38f5] text-white hover:bg-[#3d2ee0]",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Проверяем...
                  </>
                ) : (
                  "Подтвердить"
                )}
              </button>

              <div className="flex items-center justify-between text-xs">
                {timer > 0 ? (
                  <span className="flex items-center gap-1.5 text-[#666666]">
                    <Timer className="h-4 w-4" />
                    Повторная отправка через {formatTimer(timer)}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={isSendingOtp}
                    className="flex items-center gap-1.5 text-[#4a38f5] transition-colors hover:underline disabled:opacity-50"
                  >
                    {isSendingOtp ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    Отправить код повторно
                  </button>
                )}
              </div>
            </div>
          )}
        </form>
      )}

      {/* Email Tab */}
      {authStep === "email" && (
        <form
          onSubmit={emailForm.handleSubmit(handleEmailSubmit)}
          className="space-y-4"
        >
          <div className="space-y-2">
            <label
              htmlFor="email"
              className="block text-[13px] font-medium text-[#111111]"
            >
              E-mail
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@company.com"
              value={emailForm.watch("email")}
              onChange={(e) =>
                emailForm.setValue("email", e.target.value, {
                  shouldValidate: true,
                })
              }
              className={cn(
                "w-full rounded-[8px] border bg-white py-2.5 px-3 text-[13px] text-[#111111] placeholder:text-[#888888] transition-colors",
                "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                emailForm.formState.errors.email
                  ? "border-rose-500"
                  : "border-[#e5e5e5]",
              )}
            />
            {emailForm.formState.errors.email && (
              <p className="text-xs text-rose-600">
                {emailForm.formState.errors.email.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label
              htmlFor="password"
              className="block text-[13px] font-medium text-[#111111]"
            >
              Пароль
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={emailForm.watch("password")}
              onChange={(e) =>
                emailForm.setValue("password", e.target.value, {
                  shouldValidate: true,
                })
              }
              className={cn(
                "w-full rounded-[8px] border bg-white py-2.5 px-3 text-[13px] text-[#111111] placeholder:text-[#888888] transition-colors",
                "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                emailForm.formState.errors.password
                  ? "border-rose-500"
                  : "border-[#e5e5e5]",
              )}
            />
            {emailForm.formState.errors.password && (
              <p className="text-xs text-rose-600">
                {emailForm.formState.errors.password.message}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSigningIn || !emailForm.formState.isValid}
            className={cn(
              "flex h-10 w-full items-center justify-center gap-2 rounded-[8px] text-[13px] font-medium transition-colors",
              "bg-[#4a38f5] text-white hover:bg-[#3d2ee0]",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {isSigningIn ? (
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
        </form>
      )}

      <p className="mt-6 text-center text-[13px] text-[#666666]">
        Нет аккаунта?{" "}
        <a href="/register" className="font-medium text-[#4a38f5] hover:underline">
          Зарегистрировать компанию
        </a>
      </p>
    </div>
  );
}