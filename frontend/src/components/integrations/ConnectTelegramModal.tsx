"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowLeft, Loader2, MessageSquare, Phone, Send, ShieldCheck } from "lucide-react";

import { PasswordField } from "@/components/auth/PasswordField";
import { ApiClientError } from "@/lib/api/apiClient";
import { useTelegramSendCode, useTelegramSignIn } from "@/lib/api/use-telegram-auth";
import {
  telegramCodeSchema,
  telegramPasswordSchema,
  telegramSendCodeSchema,
  type TelegramCodeValues,
  type TelegramPasswordValues,
  type TelegramSendCodeValues,
} from "@/schemas/channel.schema";
import { cn } from "@/lib/utils";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";

// ---------------------------------------------------------------------------
// Мастер подключения аккаунта Telegram через MTProto.
//
// Три шага в одном окне, а не три отдельных диалога: шаги — продолжение одного
// действия, и закрытие окна между ними потеряло бы `tempSessionId`, после чего
// код пришлось бы запрашивать заново.
//
// Шаг 2FA появляется только когда сервер сообщил `requires2FA`: у аккаунта без
// облачного пароля его нет, и заранее показанное поле выглядело бы как
// обязательное.
// ---------------------------------------------------------------------------

/** Пауза перед повторной отправкой кода. Telegram сам ограничивает частоту. */
const RESEND_COOLDOWN_SECONDS = 60;

type Step = "phone" | "code" | "password";

interface ConnectTelegramModalProps {
  open: boolean;
  onClose: () => void;
}

/** Маска ввода: пользователь видит +7 905 534-24-03, сервер получает цифры. */
function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 15);
  if (digits.length === 0) return "";

  // Российский формат для 11 цифр, начинающихся с 7 или 8 — самый частый случай.
  if ((digits.startsWith("7") || digits.startsWith("8")) && digits.length <= 11) {
    const body = digits.slice(1);
    const parts = [
      body.slice(0, 3),
      body.slice(3, 6),
      body.slice(6, 8),
      body.slice(8, 10),
    ].filter((part) => part.length > 0);

    return `+7${parts.length > 0 ? " " : ""}${parts.join(" ")}`.trim();
  }

  return `+${digits}`;
}

export function ConnectTelegramModal({ open, onClose }: ConnectTelegramModalProps) {
  const sendCode = useTelegramSendCode();
  const signIn = useTelegramSignIn();

  const [step, setStep] = useState<Step>("phone");
  const [tempSessionId, setTempSessionId] = useState<string | null>(null);
  const [phoneLabel, setPhoneLabel] = useState("");
  const [isCodeViaApp, setIsCodeViaApp] = useState(true);
  const [passwordHint, setPasswordHint] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  /** Данные первого шага: нужны для повторной отправки кода. */
  const [firstStep, setFirstStep] = useState<TelegramSendCodeValues | null>(null);

  const phoneForm = useForm<TelegramSendCodeValues>({
    resolver: zodResolver(telegramSendCodeSchema),
    mode: "onChange",
    defaultValues: { name: "", phone: "" },
  });

  const codeForm = useForm<TelegramCodeValues>({
    resolver: zodResolver(telegramCodeSchema),
    mode: "onChange",
    defaultValues: { code: "" },
  });

  const passwordForm = useForm<TelegramPasswordValues>({
    resolver: zodResolver(telegramPasswordSchema),
    mode: "onChange",
    defaultValues: { password: "" },
  });

  const isPending = sendCode.isPending || signIn.isPending;

  const reset = useCallback(() => {
    setStep("phone");
    setTempSessionId(null);
    setPhoneLabel("");
    setPasswordHint(null);
    setCooldown(0);
    setFirstStep(null);
    phoneForm.reset({ name: "", phone: "" });
    codeForm.reset({ code: "" });
    passwordForm.reset({ password: "" });
  }, [phoneForm, codeForm, passwordForm]);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);


  // Таймер повторной отправки. Тикает только когда окно открыто: интервал в
  // закрытом окне продолжал бы работать и держал бы компонент в памяти.
  useEffect(() => {
    if (!open || cooldown <= 0) return;

    const timer = setInterval(() => {
      setCooldown((previous) => (previous <= 1 ? 0 : previous - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [open, cooldown]);

  const describeError = useCallback((error: unknown): string => {
    if (error instanceof ApiClientError) return error.message;
    return "Нет связи с сервером. Повторите попытку.";
  }, []);

  const requestCode = useCallback(
    async (values: TelegramSendCodeValues) => {
      try {
        const result = await sendCode.mutateAsync(values);

        setTempSessionId(result.tempSessionId);
        setIsCodeViaApp(result.isCodeViaApp);
        setPhoneLabel(values.phone);
        setFirstStep(values);
        setCooldown(RESEND_COOLDOWN_SECONDS);
        setStep("code");
        codeForm.reset({ code: "" });
      } catch (error) {
        if (error instanceof ApiClientError && error.isValidationError) {
          const fields = error.fieldErrors();
          if (fields.phone !== undefined) phoneForm.setError("phone", { message: fields.phone });
          if (fields.name !== undefined) phoneForm.setError("name", { message: fields.name });
          return;
        }

        toast.error(describeError(error));
      }
    },
    [sendCode, codeForm, phoneForm, describeError],
  );

  const submitCode = useCallback(
    async (values: TelegramCodeValues) => {
      if (tempSessionId === null) return;

      try {
        const result = await signIn.mutateAsync({
          tempSessionId,
          code: values.code,
        });

        if (result.status === "password_required") {
          // Код принят, Telegram просит второй фактор. Показываем шаг пароля, а
          // не ошибку: пользователь ничего не сделал неправильно.
          setPasswordHint(result.passwordHint);
          setStep("password");
          passwordForm.reset({ password: "" });
          return;
        }

        toast.success("Аккаунт Telegram подключён");
        onClose();
      } catch (error) {
        if (error instanceof ApiClientError && error.code === "TELEGRAM_CODE_INVALID") {
          codeForm.setError("code", { message: "Неверный код из Telegram" });
          return;
        }

        // Истёкший код и прерванная авторизация требуют начать заново — возвращаем
        // на первый шаг, иначе пользователь остаётся на экране, где любое действие
        // отклоняется.
        if (
          error instanceof ApiClientError &&
          (error.code === "TELEGRAM_CODE_EXPIRED" ||
            error.code === "TELEGRAM_SESSION_EXPIRED" ||
            error.code === "TELEGRAM_AUTH_RESTART" ||
            error.code === "TELEGRAM_TOO_MANY_ATTEMPTS")
        ) {
          toast.error(error.message);
          setStep("phone");
          setTempSessionId(null);
          return;
        }

        toast.error(describeError(error));
      }
    },
    [signIn, tempSessionId, codeForm, passwordForm, onClose, describeError],
  );

  const submitPassword = useCallback(
    async (values: TelegramPasswordValues) => {
      if (tempSessionId === null) return;

      try {
        const result = await signIn.mutateAsync({
          tempSessionId,
          password: values.password,
        });

        if (result.status === "connected") {
          toast.success("Аккаунт Telegram подключён");
          onClose();
        }
      } catch (error) {
        if (error instanceof ApiClientError && error.code === "TELEGRAM_PASSWORD_INVALID") {
          passwordForm.setError("password", { message: "Неверный облачный пароль" });
          return;
        }

        if (
          error instanceof ApiClientError &&
          (error.code === "TELEGRAM_SESSION_EXPIRED" || error.code === "TELEGRAM_TOO_MANY_ATTEMPTS")
        ) {
          toast.error(error.message);
          setStep("phone");
          setTempSessionId(null);
          return;
        }

        toast.error(describeError(error));
      }
    },
    [signIn, tempSessionId, passwordForm, onClose, describeError],
  );

  const resend = useCallback(async () => {
    if (firstStep === null || cooldown > 0) return;
    await requestCode(firstStep);
  }, [firstStep, cooldown, requestCode]);

  const stepMeta = useMemo(() => {
    switch (step) {
      case "phone":
        return { title: "Подключить Telegram", caption: "Шаг 1 из 2 — номер телефона" };
      case "code":
        return {
          title: "Код подтверждения",
          caption: isCodeViaApp
            ? "Шаг 2 из 2 — код пришёл в приложение Telegram"
            : "Шаг 2 из 2 — код пришёл по SMS",
        };
      case "password":
        return { title: "Облачный пароль", caption: "Шаг 3 из 3 — двухэтапная проверка" };
    }
  }, [step, isCodeViaApp]);

  return (
    <Sheet open={open} onClose={onClose} width="w-[520px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-[#4a38f5]/10">
            {step === "password" ? (
              <ShieldCheck className="h-3.5 w-3.5 text-[#4a38f5]" />
            ) : step === "code" ? (
              <MessageSquare className="h-3.5 w-3.5 text-[#4a38f5]" />
            ) : (
              <Send className="h-3.5 w-3.5 text-[#4a38f5]" />
            )}
          </div>
          <div>
            <h2 id="connect-telegram-title" className="text-sm font-semibold text-[#111111]">
              {stepMeta.title}
            </h2>
            <p className="text-[11px] text-[#666666]">{stepMeta.caption}</p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent>
        {step === "phone" && (
          <form
            onSubmit={phoneForm.handleSubmit((values) => void requestCode(values))}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <label htmlFor="tg_name" className="block text-xs font-medium text-[#666666]">
                Название подключения
              </label>
              <input
                id="tg_name"
                autoFocus
                autoComplete="off"
                placeholder="Рабочий номер"
                {...phoneForm.register("name")}
                className={cn(
                  "h-8 w-full rounded-[4px] border bg-white px-2.5 text-xs text-[#111111] placeholder:text-[#888888]",
                  "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                  phoneForm.formState.errors.name !== undefined
                    ? "border-rose-500"
                    : "border-[#e5e5e5]",
                )}
              />
              {phoneForm.formState.errors.name && (
                <p className="text-xs text-rose-500">{phoneForm.formState.errors.name.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="tg_phone" className="block text-xs font-medium text-[#666666]">
                Номер телефона аккаунта
              </label>
              <div className="relative">
                <Phone className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#888888]" />
                <input
                  id="tg_phone"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="+7 900 000-00-00"
                  {...phoneForm.register("phone", {
                    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                      phoneForm.setValue("phone", formatPhoneInput(event.target.value), {
                        shouldValidate: true,
                      });
                    },
                  })}
                  className={cn(
                    "h-8 w-full rounded-[4px] border bg-white py-1.5 pl-8 pr-2.5 text-xs text-[#111111] placeholder:text-[#888888]",
                    "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                    phoneForm.formState.errors.phone !== undefined
                      ? "border-rose-500"
                      : "border-[#e5e5e5]",
                  )}
                />
              </div>
              {phoneForm.formState.errors.phone && (
                <p className="text-xs text-rose-500">{phoneForm.formState.errors.phone.message}</p>
              )}
            </div>

            <p className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 text-xs leading-relaxed text-[#666666]">
              CRM получит доступ к переписке этого аккаунта, как обычный клиент
              Telegram. Сессия хранится в зашифрованном виде и отзывается в
              настройках Telegram в любой момент.
            </p>

            <div className="flex items-center justify-end gap-2 border-t border-[#e5e5e5] pt-4">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#fafafa] disabled:opacity-40"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white transition-colors hover:bg-[#3b2be0] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sendCode.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Отправляем код...
                  </>
                ) : (
                  "Получить код"
                )}
              </button>
            </div>
          </form>
        )}

        {step === "code" && (
          <form
            onSubmit={codeForm.handleSubmit((values) => void submitCode(values))}
            className="space-y-4"
          >
            <p className="text-xs text-[#666666]">
              Код отправлен на <span className="font-medium text-[#111111]">{phoneLabel}</span>.
              {isCodeViaApp
                ? " Откройте Telegram на устройстве, где вы уже вошли."
                : " Проверьте SMS."}
            </p>

            <div className="space-y-1.5">
              <label htmlFor="tg_code" className="block text-xs font-medium text-[#666666]">
                Код из Telegram
              </label>
              <input
                id="tg_code"
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="12345"
                {...codeForm.register("code")}
                className={cn(
                  "h-10 w-full rounded-[4px] border bg-white px-3 text-center text-lg font-semibold tracking-[0.4em] text-[#111111] placeholder:tracking-normal placeholder:text-[#888888]",
                  "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                  codeForm.formState.errors.code !== undefined
                    ? "border-rose-500"
                    : "border-[#e5e5e5]",
                )}
              />
              {codeForm.formState.errors.code && (
                <p className="text-xs text-rose-500">{codeForm.formState.errors.code.message}</p>
              )}
            </div>

            <button
              type="button"
              onClick={() => void resend()}
              disabled={cooldown > 0 || isPending}
              className="text-xs font-medium text-[#4a38f5] transition-colors hover:text-[#3b2be0] disabled:text-[#888888]"
            >
              {cooldown > 0 ? `Отправить код снова через ${cooldown} с` : "Отправить код снова"}
            </button>

            <div className="flex items-center justify-between gap-2 border-t border-[#e5e5e5] pt-4">
              <button
                type="button"
                onClick={() => setStep("phone")}
                disabled={isPending}
                className="flex h-8 items-center gap-1 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#fafafa] disabled:opacity-40"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Назад
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white transition-colors hover:bg-[#3b2be0] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {signIn.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Проверяем...
                  </>
                ) : (
                  "Подтвердить"
                )}
              </button>
            </div>
          </form>
        )}

        {step === "password" && (
          <form
            onSubmit={passwordForm.handleSubmit((values) => void submitPassword(values))}
            className="space-y-4"
          >
            <div className="flex gap-2.5 rounded-[8px] border border-sky-500/20 bg-sky-500/5 p-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
              <p className="text-xs leading-relaxed text-[#666666]">
                У аккаунта включена двухэтапная проверка. Введите облачный пароль —
                тот, который запрашивает Telegram при входе с нового устройства.
                {passwordHint !== null && passwordHint.length > 0 && (
                  <>
                    {" "}
                    Подсказка: <span className="font-medium text-[#111111]">{passwordHint}</span>
                  </>
                )}
              </p>
            </div>

            <PasswordField
              label="Облачный пароль (2FA)"
              autoFocus
              autoComplete="off"
              placeholder="••••••••"
              error={passwordForm.formState.errors.password?.message}
              className="h-8 rounded-[4px] border-[#e5e5e5] bg-white text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:ring-[#4a38f5]/20"
              {...passwordForm.register("password")}
            />

            <div className="flex items-center justify-end gap-2 border-t border-[#e5e5e5] pt-4">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#fafafa] disabled:opacity-40"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white transition-colors hover:bg-[#3b2be0] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {signIn.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Подключаем...
                  </>
                ) : (
                  "Подключить"
                )}
              </button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
