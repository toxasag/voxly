"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  ArrowRight,
  Check,
  ExternalLink,
  Globe,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  Send,
  X,
} from "lucide-react";
import {
  registerDetailsSchema,
  type RegisterDetailsValues,
} from "@/schemas/auth.schema";
import { cn, formatPhone } from "@/lib/utils";
import { useAuth, type AuthChannel } from "@/lib/auth/use-auth";
import { CHANNEL_LABEL, useCodeFlow } from "@/lib/auth/use-code-flow";
import { apiClient, ApiClientError } from "@/lib/api/apiClient";
import { tenantPortalUrl } from "@/lib/auth/tenant-host";
import { PasswordField } from "@/components/auth/PasswordField";

interface SlugAvailabilityDTO {
  slug: string;
  available: boolean;
  reason: string | null;
}

type SlugStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "taken"; message: string };

/** Debounce для проверки занятости: один запрос на паузу в вводе. */
const SLUG_CHECK_DEBOUNCE_MS = 400;

const SLUG_REASON_TEXT: Record<string, string> = {
  RESERVED: "Этот поддомен зарезервирован платформой",
  TAKEN: "Этот поддомен уже занят",
  INVALID_FORMAT: "Недопустимый формат поддомена",
};

const CHANNELS: { value: AuthChannel; label: string; icon: typeof Send }[] = [
  { value: "telegram", label: "Telegram", icon: Send },
  { value: "max", label: "MAX", icon: MessageCircle },
];

/**
 * Нормализация поддомена.
 *
 * Кириллица транслитерируется, а не отбрасывается: иначе для компании с русским
 * названием поле оставалось бы пустым.
 */
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

export function slugify(input: string): string {
  let out = "";
  for (const char of input.toLowerCase()) {
    if (char in TRANSLIT) out += TRANSLIT[char];
    else if (/[a-z0-9]/.test(char)) out += char;
    else out += "-";
  }
  return out.replace(/-+/g, "-").replace(/^-/, "").slice(0, 63).replace(/-$/, "");
}

export function RegisterForm() {
  const { register: registerTenant } = useAuth();
  const code = useCodeFlow("register");

  const [slugStatus, setSlugStatus] = useState<SlugStatus>({ kind: "idle" });
  const [otp, setOtp] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  const form = useForm<RegisterDetailsValues>({
    resolver: zodResolver(registerDetailsSchema),
    mode: "onChange",
    defaultValues: {
      slug: "",
      email: "",
      password: "",
      password_confirm: "",
      phone: "+7 ",
      channel: "telegram",
    },
  });

  const slugValue = form.watch("slug");
  const channel = form.watch("channel");
  const otpInputRef = useRef<HTMLInputElement>(null);

  /** Автофокус на поле кода, как только код доставлен. */
  useEffect(() => {
    if (code.stage === "sent") otpInputRef.current?.focus();
  }, [code.stage]);

  useEffect(() => {
    if (slugValue.length < 3 || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slugValue)) {
      setSlugStatus({ kind: "idle" });
      return;
    }

    let cancelled = false;
    setSlugStatus({ kind: "checking" });

    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.get<SlugAvailabilityDTO>("/auth/slug-available", {
          query: { slug: slugValue },
        });
        if (cancelled) return;

        setSlugStatus(
          res.data.available
            ? { kind: "available" }
            : {
                kind: "taken",
                message: SLUG_REASON_TEXT[res.data.reason ?? "TAKEN"] ?? "Поддомен недоступен",
              },
        );
      } catch {
        // Сбой проверки не блокирует форму: сервер проверит ещё раз при отправке.
        if (!cancelled) setSlugStatus({ kind: "idle" });
      }
    }, SLUG_CHECK_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slugValue]);

  const handleSlugChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      // Нормализуем на вводе, чтобы в поле не оказалось значения, которое
      // сервер заведомо отклонит.
      form.setValue("slug", slugify(event.target.value), { shouldValidate: true });
    },
    [form],
  );

  const handlePhoneChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      form.setValue("phone", formatPhone(event.target.value), { shouldValidate: true });
    },
    [form],
  );

  /** «Получить код»: валидируем поля до кода, затем запрашиваем доставку. */
  const handleRequestCode = useCallback(async () => {
    const valid = await form.trigger();
    if (!valid) {
      toast.error("Заполните поля формы перед запросом кода");
      return;
    }
    if (slugStatus.kind === "taken") {
      toast.error(slugStatus.message);
      return;
    }

    const values = form.getValues();
    setOtpError(null);
    await code.request({
      channel: values.channel,
      phone: values.phone,
      email: values.email,
    });
  }, [form, code, slugStatus]);

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
      const session = await registerTenant({
        slug: values.slug,
        email: values.email,
        phone: values.phone,
        password: values.password,
        session_id: code.sessionId,
        code: otp,
      });

      toast.success(`Компания создана: ${session.slug}.getvoxly.ru`);
      // Полная навигация: целевой поддомен — другой origin.
      window.location.href = tenantPortalUrl(session.slug, "/dashboard");
    } catch (error) {
      if (error instanceof ApiClientError) {
        const fields = error.fieldErrors();
        let mapped = false;

        for (const [field, message] of Object.entries(fields)) {
          if (field === "_root") continue;
          if (field === "code") {
            setOtpError(message);
            mapped = true;
            continue;
          }
          if (field in values) {
            form.setError(field as keyof RegisterDetailsValues, { message });
            mapped = true;
          }
        }

        if (error.code === "SLUG_TAKEN") {
          setSlugStatus({ kind: "taken", message: "Этот поддомен только что занят" });
        }
        if (error.status === 401) setOtpError(error.message);

        toast.error(mapped ? "Проверьте выделенные поля" : error.message);
      } else {
        toast.error("Нет связи с сервером. Проверьте подключение и повторите попытку.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [code.sessionId, otp, form, registerTenant]);

  const errors = form.formState.errors;
  const codeRequested = code.stage === "sent" || code.stage === "awaiting_bot";

  const inputClass = (hasError: boolean): string =>
    cn(
      "w-full rounded-[8px] border bg-white py-2.5 pl-10 pr-4 text-[13px] text-[#111111] placeholder:text-[#888888] transition-colors",
      "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
hasError ? "border-rose-500" : "border-[#e5e5e5]",
    );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
      className="space-y-4"
    >
      {/* Адрес портала */}
<div className="space-y-2">
        <label htmlFor="slug" className="block text-[13px] font-medium text-[#111111]">
          Адрес портала
        </label>
        <div className="relative">
          <Globe className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#888888]" />
          <input
            id="slug"
            type="text"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            placeholder="mycompany"
            value={slugValue}
            onChange={handleSlugChange}
            className={cn(
              inputClass(errors.slug !== undefined || slugStatus.kind === "taken"),
              "pr-32 font-mono tabular-nums",
            )}
          />
          <span className="pointer-events-none absolute right-10 top-1/2 -translate-y-1/2 text-[13px] text-[#888888]">
            .getvoxly.ru
          </span>
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            {slugStatus.kind === "checking" && (
<Loader2 className="h-4 w-4 animate-spin text-[#4a38f5]" />
            )}
            {slugStatus.kind === "available" && <Check className="h-4 w-4 text-emerald-600" />}
            {slugStatus.kind === "taken" && <X className="h-4 w-4 text-rose-600" />}
          </span>
        </div>
        {errors.slug ? (
          <p className="text-xs text-rose-600">{errors.slug.message}</p>
        ) : slugStatus.kind === "taken" ? (
          <p className="text-xs text-rose-600">{slugStatus.message}</p>
        ) : slugStatus.kind === "available" ? (
          <p className="text-xs text-emerald-600">Адрес свободен: {slugValue}.getvoxly.ru</p>
        ) : (
<p className="text-xs text-[#666666]">Латиница, цифры и дефис</p>
        )}
      </div>

      {/* E-mail */}
<div className="space-y-2">
        <label htmlFor="email" className="block text-[13px] font-medium text-[#111111]">
          E-mail
        </label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#888888]" />
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.ru"
            {...form.register("email")}
            className={inputClass(errors.email !== undefined)}
          />
        </div>
        {errors.email && <p className="text-xs text-rose-600">{errors.email.message}</p>}
      </div>

      {/* Пароль */}
      <PasswordField
        id="reg_password"
        label="Пароль"
        autoComplete="new-password"
        placeholder="••••••••"
        error={errors.password?.message}
        hint="Минимум 8 символов"
        {...form.register("password")}
      />

      {/* Повторите пароль */}
      <PasswordField
        id="reg_password_confirm"
        label="Повторите пароль"
        autoComplete="new-password"
        placeholder="••••••••"
        error={errors.password_confirm?.message}
        {...form.register("password_confirm")}
      />

      {/* Телефон */}
<div className="space-y-2">
        <label htmlFor="reg_phone" className="block text-[13px] font-medium text-[#111111]">
          Телефон
        </label>
        <div className="relative">
          <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#888888]" />
          <input
            id="reg_phone"
            type="tel"
            autoComplete="tel"
            placeholder="+7 999 999 99 99"
            value={form.watch("phone")}
            onChange={handlePhoneChange}
            className={cn(inputClass(errors.phone !== undefined), "font-mono tabular-nums")}
          />
        </div>
        {errors.phone && <p className="text-xs text-rose-600">{errors.phone.message}</p>}
      </div>

      {/* Способ доставки кода */}
<fieldset className="space-y-2">
        <legend className="block text-[13px] font-medium text-[#111111]">
          Способ доставки кода
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
          Код придёт в {CHANNEL_LABEL[channel]}. Если бот ещё не привязан, появится ссылка на
          подключение.
        </p>
      </fieldset>

      {/* Получить код */}
      {!codeRequested && (
        <button
          type="button"
          onClick={() => void handleRequestCode()}
          disabled={code.stage === "requesting"}
          className={cn(
"flex h-10 w-full items-center justify-center gap-2 rounded-[8px] text-[13px] font-medium shadow-2xs transition-colors",
            "bg-[#4a38f5] text-white hover:bg-[#3d2ee0]",
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

      {/* Привязка бота: код придёт после нажатия Start */}
      {code.error !== null && code.stage === "idle" && (
        <p role="alert" className="rounded-[8px] border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          {code.error}
        </p>
      )}

      {code.stage === "awaiting_bot" && code.deepLink !== null && (
<div className="space-y-3 rounded-[8px] border border-[#4a38f5]/20 bg-[#4a38f5]/5 p-4">
          <p className="text-[13px] text-[#111111]">
            Откройте бота <span className="font-semibold text-[#4a38f5]">@{code.botUsername}</span> и
            нажмите «Start» — код придёт автоматически.
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

      {/* Код подтверждения */}
      {code.stage === "sent" && (
<div className="space-y-2">
          <label htmlFor="reg_code" className="block text-[13px] font-medium text-[#111111]">
            Код подтверждения
          </label>
          <input
            id="reg_code"
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
          {otpError !== null && (
            <p className="text-center text-xs text-rose-600">{otpError}</p>
          )}

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

      {/* Зарегистрироваться — активна только после доставки кода */}
      <button
        type="submit"
        disabled={isSubmitting || code.stage !== "sent" || otp.length !== 6}
        className={cn(
"flex h-10 w-full items-center justify-center gap-2 rounded-[8px] text-[13px] font-medium shadow-2xs transition-colors",
          "bg-[#4a38f5] text-white hover:bg-[#3d2ee0]",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Создаём компанию...
          </>
        ) : (
          <>
            Зарегистрироваться
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>

<p className="text-center text-[13px] text-[#666666]">
        Уже есть аккаунт?{" "}
        <a href="/login" className="font-medium text-[#4a38f5] hover:underline">
          Войти
        </a>
      </p>
    </form>
  );
}
