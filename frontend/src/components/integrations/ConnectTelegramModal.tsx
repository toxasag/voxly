"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Phone,
  QrCode,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";

import { PasswordField } from "@/components/auth/PasswordField";
import { ApiClientError } from "@/lib/api/apiClient";
import {
  useTelegramCheckAccount,
  useTelegramQrPassword,
  useTelegramQrStatus,
  useTelegramSendCode,
  useTelegramSignIn,
  useTelegramStartQr,
} from "@/lib/api/use-telegram-auth";
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
// Мастер подключения аккаунта Telegram:
// 1. По QR-коду (рекомендуемый, быстрый через «Устройства» в Telegram)
// 2. По номеру телефона (код из приложения/SMS + 2FA пароль)
// ---------------------------------------------------------------------------

type AuthMode = "qr" | "phone";
type PhoneStep = "phone" | "code" | "password";

interface ConnectTelegramModalProps {
  open: boolean;
  onClose: () => void;
}

/** Маска ввода: пользователь видит +7 905 534-24-03, сервер получает цифры. */
function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 15);
  if (digits.length === 0) return "";

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
  const [mode, setMode] = useState<AuthMode>("qr");

  // --- Состояние для QR-авторизации ---
  const [qrName, setQrName] = useState("Основной");
  const [qrSessionId, setQrSessionId] = useState<string | null>(null);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [qr2faPassword, setQr2faPassword] = useState("");
  const [isSubmittingQr2fa, setIsSubmittingQr2fa] = useState(false);
  const startedQrRef = useRef(false);

  const startQr = useTelegramStartQr();
  const { data: qrStatusData } = useTelegramQrStatus(
    qrSessionId,
    open && mode === "qr" && Boolean(qrSessionId),
  );
  const submitQr2fa = useTelegramQrPassword();

  const isQrConnected = qrStatusData?.status === "connected";
  const isQrWaiting2fa = qrStatusData?.status === "requires_2fa";

  // --- Состояние для авторизации по номеру телефона ---
  const sendCode = useTelegramSendCode();
  const signIn = useTelegramSignIn();

  const [step, setStep] = useState<PhoneStep>("phone");
  const [tempSessionId, setTempSessionId] = useState<string | null>(null);
  const [phoneLabel, setPhoneLabel] = useState("");
  const [isCodeViaApp, setIsCodeViaApp] = useState(true);
  const [passwordHint, setPasswordHint] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
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

  const isPending = sendCode.isPending || signIn.isPending || startQr.isPending || isSubmittingQr2fa;

  const handleStartQr = useCallback(
    (customName?: string) => {
      const activeName = customName ?? qrName;
      startQr.mutate(
        { name: activeName },
        {
          onSuccess: (res) => {
            setQrSessionId(res.tempSessionId);
            if (res.qr) setQrBase64(res.qr);
          },
          onError: (err) => {
            toast.error(err.message || "Не удалось запустить подключение Telegram по QR-коду");
          },
        },
      );
    },
    [qrName, startQr],
  );

  // Сброс при открытии
  useEffect(() => {
    if (open) {
      setMode("qr");
      setQrName("Основной");
      setQrSessionId(null);
      setQrBase64(null);
      setQr2faPassword("");
      startedQrRef.current = false;

      setStep("phone");
      setTempSessionId(null);
      setPhoneLabel("");
      setPasswordHint(null);
      setCooldown(0);
      setFirstStep(null);
      phoneForm.reset({ name: "", phone: "" });
      codeForm.reset({ code: "" });
      passwordForm.reset({ password: "" });

      // Запускаем QR ровно один раз
      startedQrRef.current = true;
      handleStartQr("Основной");
    } else {
      startedQrRef.current = false;
    }
  }, [open]);

  // Обновление QR-кода при получении из статуса
  useEffect(() => {
    if (qrStatusData?.status === "waiting" && qrStatusData.qr) {
      setQrBase64(qrStatusData.qr);
    }
    if (qrStatusData?.status === "connected") {
      const userName = [qrStatusData.user.firstName, qrStatusData.user.lastName]
        .filter(Boolean)
        .join(" ");
      const userTag = qrStatusData.user.username ? `@${qrStatusData.user.username}` : "";
      toast.success(`Telegram аккаунт ${userName || userTag} успешно подключён!`);
    }
  }, [qrStatusData]);

  // Таймер повторной отправки SMS/кода
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

  const handleQrPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qrSessionId || !qr2faPassword) return;

    setIsSubmittingQr2fa(true);
    try {
      await submitQr2fa.mutateAsync({
        tempSessionId: qrSessionId,
        password: qr2faPassword,
      });
      toast.success("Telegram успешно подключён с двухэтапной аутентификацией!");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Неверный облачный пароль (2FA)";
      toast.error(message);
    } finally {
      setIsSubmittingQr2fa(false);
    }
  };

  const requestCode = useCallback(
    async (values: TelegramSendCodeValues) => {
      try {
        const result = await sendCode.mutateAsync(values);

        setTempSessionId(result.tempSessionId);
        setIsCodeViaApp(result.isCodeViaApp);
        setPhoneLabel(values.phone);
        setFirstStep(values);
        setCooldown(60);
        setStep("code");
      } catch (error) {
        if (error instanceof ApiClientError && error.code === "TELEGRAM_PHONE_INVALID") {
          phoneForm.setError("phone", { message: "Telegram не принял этот номер телефона" });
          return;
        }

        if (error instanceof ApiClientError && error.code === "TELEGRAM_PHONE_BANNED") {
          phoneForm.setError("phone", { message: "Этот номер заблокирован в Telegram" });
          return;
        }

        toast.error(describeError(error));
      }
    },
    [sendCode, phoneForm, describeError],
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
          setPasswordHint(result.passwordHint);
          setStep("password");
          return;
        }

        if (result.status === "connected") {
          toast.success("Аккаунт Telegram подключён");
          onClose();
        }
      } catch (error) {
        if (error instanceof ApiClientError && error.code === "TELEGRAM_CODE_INVALID") {
          codeForm.setError("code", { message: "Неверный код из Telegram" });
          return;
        }

        if (error instanceof ApiClientError && error.code === "TELEGRAM_CODE_EXPIRED") {
          toast.error("Код истёк. Запросите новый код.");
          setStep("phone");
          return;
        }

        toast.error(describeError(error));
      }
    },
    [signIn, tempSessionId, codeForm, onClose, describeError],
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

  return (
    <Sheet open={open} onClose={onClose} width="w-[520px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-[#4a38f5]/10">
            {mode === "qr" ? (
              <QrCode className="h-3.5 w-3.5 text-[#4a38f5]" />
            ) : step === "password" ? (
              <ShieldCheck className="h-3.5 w-3.5 text-[#4a38f5]" />
            ) : step === "code" ? (
              <MessageSquare className="h-3.5 w-3.5 text-[#4a38f5]" />
            ) : (
              <Send className="h-3.5 w-3.5 text-[#4a38f5]" />
            )}
          </div>
          <div>
            <h2 id="connect-telegram-title" className="text-sm font-semibold text-[#111111]">
              Подключить Telegram
            </h2>
            <p className="text-[11px] text-[#666666]">
              {mode === "qr"
                ? "Мгновенная авторизация через QR-код"
                : step === "code"
                  ? "Ввод кода подтверждения"
                  : step === "password"
                    ? "Двухэтапная проверка (облачный пароль)"
                    : "Подключение по номеру телефона"}
            </p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="p-6">
        {/* Переключатель способа авторизации */}
        <div className="mb-5 flex rounded-[8px] bg-[#f5f5f5] p-1 gap-1">
          <button
            type="button"
            onClick={() => {
              setMode("qr");
              if (!qrSessionId && !startQr.isPending) {
                handleStartQr();
              }
            }}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-[6px] py-1.5 text-xs font-medium transition-all cursor-pointer",
              mode === "qr"
                ? "bg-white text-[#111111] shadow-2xs font-semibold"
                : "text-[#666666] hover:text-[#111111]",
            )}
          >
            <QrCode className="h-3.5 w-3.5" />
            <span>По QR-коду (Быстро)</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("phone")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-[6px] py-1.5 text-xs font-medium transition-all cursor-pointer",
              mode === "phone"
                ? "bg-white text-[#111111] shadow-2xs font-semibold"
                : "text-[#666666] hover:text-[#111111]",
            )}
          >
            <Phone className="h-3.5 w-3.5" />
            <span>По номеру телефона</span>
          </button>
        </div>

        {/* -------------------- РЕЖИМ QR-КОДА -------------------- */}
        {mode === "qr" && (
          <div>
            {isQrConnected ? (
              <div className="flex flex-col items-center justify-center space-y-4 py-8 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-[#111111]">Telegram подключён!</h3>
                  <p className="mt-1 text-xs text-[#666666]">
                    Аккаунт успешно авторизован в CRM. Входящие и исходящие сообщения теперь синхронизируются.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="mt-4 rounded-[8px] bg-[#4a38f5] px-5 py-2 text-xs font-medium text-white transition-colors hover:bg-[#3d2ee0] cursor-pointer"
                >
                  Готово
                </button>
              </div>
            ) : isQrWaiting2fa ? (
              <form onSubmit={handleQrPasswordSubmit} className="space-y-4">
                <div className="flex gap-2.5 rounded-[8px] border border-sky-500/20 bg-sky-500/5 p-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                  <p className="text-xs leading-relaxed text-[#666666]">
                    У аккаунта включена двухэтапная проверка в Telegram. Введите облачный пароль.
                    {qrStatusData.passwordHint && (
                      <>
                        {" "}
                        Подсказка:{" "}
                        <span className="font-medium text-[#111111]">
                          {qrStatusData.passwordHint}
                        </span>
                      </>
                    )}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-[#666666]">
                    Облачный пароль (2FA)
                  </label>
                  <input
                    type="password"
                    value={qr2faPassword}
                    onChange={(e) => setQr2faPassword(e.target.value)}
                    placeholder="••••••••"
                    autoFocus
                    className="h-8 w-full rounded-[4px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-[#e5e5e5] pt-4">
                  <button
                    type="button"
                    onClick={onClose}
                    className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#fafafa]"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingQr2fa || !qr2faPassword}
                    className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white hover:bg-[#3d2ee0] disabled:opacity-50 cursor-pointer"
                  >
                    {isSubmittingQr2fa ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Проверяем...
                      </>
                    ) : (
                      "Подтвердить пароль"
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <label htmlFor="tg_qr_name" className="block text-xs font-medium text-[#666666]">
                    Название подключения
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="tg_qr_name"
                      value={qrName}
                      onChange={(e) => setQrName(e.target.value)}
                      placeholder="Основной"
                      disabled={startQr.isPending}
                      className="h-8 flex-1 rounded-[4px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                    />
                    <button
                      type="button"
                      onClick={() => handleStartQr()}
                      disabled={startQr.isPending || !qrName.trim()}
                      className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] transition-colors hover:bg-[#fafafa] disabled:opacity-50 cursor-pointer"
                    >
                      {startQr.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Обновить QR
                    </button>
                  </div>
                </div>

                {/* Блок с QR-кодом */}
                <div className="flex flex-col items-center justify-center rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-6">
                  {startQr.isPending && !qrBase64 ? (
                    <div className="flex h-52 flex-col items-center justify-center space-y-3">
                      <Loader2 className="h-8 w-8 animate-spin text-[#4a38f5]" />
                      <p className="text-xs text-[#666666]">Генерируем QR-код авторизации...</p>
                    </div>
                  ) : qrBase64 ? (
                    <div className="space-y-3 text-center">
                      <div className="relative inline-block rounded-xl border border-[#e5e5e5] bg-white p-3 shadow-xs">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={qrBase64}
                          alt="Telegram QR Code"
                          className="h-52 w-52 object-contain"
                        />
                      </div>
                      <div className="flex items-center justify-center gap-2 text-xs text-[#666666]">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                        </span>
                        Ожидание сканирования в приложении Telegram...
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-52 flex-col items-center justify-center space-y-3">
                      <QrCode className="h-10 w-10 text-[#888888]" />
                      <p className="text-xs text-[#666666]">Нажмите «Обновить QR», чтобы получить код</p>
                    </div>
                  )}
                </div>

                {/* Инструкция */}
                <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 space-y-2.5">
                  <h4 className="text-xs font-semibold text-[#111111]">Как подключить Telegram:</h4>
                  <ol className="list-decimal pl-4 space-y-1.5 text-xs text-[#666666]">
                    <li>Откройте приложение <strong>Telegram</strong> на смартфоне.</li>
                    <li>
                      Перейдите в <strong>Настройки</strong> → <strong>Устройства</strong>.
                    </li>
                    <li>
                      Нажмите кнопку <strong>Подключить устройство</strong>.
                    </li>
                    <li>Наведите камеру на QR-код выше для мгновенного входа.</li>
                  </ol>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-[#e5e5e5] pt-4">
                  <button
                    type="button"
                    onClick={onClose}
                    className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#fafafa] cursor-pointer"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* -------------------- РЕЖИМ НОМЕРА ТЕЛЕФОНА -------------------- */}
        {mode === "phone" && (
          <div>
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
                  CRM получит доступ к переписке этого аккаунта, как обычный клиент Telegram.
                  Сессия хранится в зашифрованном виде и отзывается в настройках Telegram в любой момент.
                </p>

                <div className="flex items-center justify-end gap-2 border-t border-[#e5e5e5] pt-4">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isPending}
                    className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#fafafa] disabled:opacity-40 cursor-pointer"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    disabled={isPending}
                    className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white transition-colors hover:bg-[#3b2be0] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
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
                  className="text-xs font-medium text-[#4a38f5] transition-colors hover:text-[#3b2be0] disabled:text-[#888888] cursor-pointer"
                >
                  {cooldown > 0 ? `Отправить код снова через ${cooldown} с` : "Отправить код снова"}
                </button>

                <div className="flex items-center justify-between gap-2 border-t border-[#e5e5e5] pt-4">
                  <button
                    type="button"
                    onClick={() => setStep("phone")}
                    disabled={isPending}
                    className="flex h-8 items-center gap-1 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#fafafa] disabled:opacity-40 cursor-pointer"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Назад
                  </button>
                  <button
                    type="submit"
                    disabled={isPending}
                    className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white transition-colors hover:bg-[#3b2be0] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
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
                    У аккаунта включена двухэтапная проверка. Введите облачный пароль — тот, который запрашивает Telegram при входе с нового устройства.
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
                    className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#fafafa] disabled:opacity-40 cursor-pointer"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    disabled={isPending}
                    className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white transition-colors hover:bg-[#3b2be0] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
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
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
