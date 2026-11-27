"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Phone,
  QrCode,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import {
  useMaxPassword,
  useMaxPhoneCallCheck,
  useMaxPhonePassword,
  useMaxPhoneStart,
  useMaxPhoneVerify,
  useMaxQrStatus,
  useMaxStartQr,
  type MaxProviderType,
} from "@/lib/api/use-max-auth";
import type { ChannelAccountDTO } from "@/lib/api/use-channels";
import { ApiClientError } from "@/lib/api/apiClient";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface ConnectMaxModalProps {
  open: boolean;
  onClose: () => void;
  initialAccount?: ChannelAccountDTO | null;
}

type AuthMode = "qr" | "phone";
type PhoneStep = "input" | "code" | "password" | "authorized";

function resolveInitialProvider(account?: ChannelAccountDTO | null): MaxProviderType {
  if (account?.provider === "native-ts" || account?.provider === "ts") {
    return "native-ts";
  }
  return "max-bridge";
}

export function ConnectMaxModal({ open, onClose, initialAccount }: ConnectMaxModalProps) {
  const queryClient = useQueryClient();
  const [authMode, setAuthMode] = useState<AuthMode>("qr");
  const [provider, setProvider] = useState<MaxProviderType>(() => resolveInitialProvider(initialAccount));
  const [name, setName] = useState(initialAccount?.label || "Основной");
  const [password, setPassword] = useState("");
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);

  // Состояние входа по телефону + SMS / звонок + 2FA
  const [phoneStep, setPhoneStep] = useState<PhoneStep>("input");
  const [phone, setPhone] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [phoneAuthSessionId, setPhoneAuthSessionId] = useState<string | null>(null);
  const [phoneHasCallTrack, setPhoneHasCallTrack] = useState(false);
  const [phonePasswordHint, setPhonePasswordHint] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneCaptchaBlocked, setPhoneCaptchaBlocked] = useState(false);
  const [phoneUserLabel, setPhoneUserLabel] = useState<string | null>(null);

  const startedRef = useRef(false);

  const startQr = useMaxStartQr();
  const submitPassword = useMaxPassword();
  const startPhone = useMaxPhoneStart();
  const verifyPhone = useMaxPhoneVerify();
  const checkPhoneCall = useMaxPhoneCallCheck();
  const submitPhonePassword = useMaxPhonePassword();

  const { data: statusData, refetch } = useMaxQrStatus(
    name,
    open && authMode === "qr" && Boolean(name),
    initialAccount?.id,
    provider,
  );

  useEffect(() => {
    if (statusData?.status === "qr_ready" && statusData?.qr) {
      setQrBase64(statusData.qr);
    } else if (statusData?.status && statusData.status !== "qr_ready") {
      setQrBase64(null);
    }
  }, [statusData?.qr, statusData?.status]);

  const isQrConnected = authMode === "qr" && statusData?.status === "authorized";
  const isPhoneConnected = authMode === "phone" && phoneStep === "authorized";
  const isConnected = isQrConnected || isPhoneConnected;

  const isWaitingPassword =
    authMode === "qr" &&
    (statusData?.status === "waiting_password" ||
      statusData?.status === "processing_password" ||
      Boolean(statusData?.passwordHint && statusData?.status !== "error"));
  const isError =
    authMode === "qr" &&
    (statusData?.status === "error" ||
      (Boolean(statusData?.error) &&
        statusData?.status !== "waiting_password" &&
        statusData?.status !== "processing_password"));
  const isPreparing = authMode === "qr" && (startQr.isPending || statusData?.status === "preparing");
  const activeQr = !isError && statusData?.status === "qr_ready" ? (statusData?.qr || qrBase64) : null;

  const handleStart = (
    customName?: string,
    customBotId?: string,
    customProvider?: MaxProviderType,
  ) => {
    if (startQr.isPending) return;
    const activeName = customName ?? name;
    const activeBotId = customBotId ?? initialAccount?.id;
    const activeProvider = customProvider ?? provider;
    setQrBase64(null);
    setPassword("");
    queryClient.removeQueries({
      queryKey: ["max", "qr-status", activeBotId ?? null, activeProvider, activeName],
    });
    startQr.mutate(
      {
        name: activeName,
        provider: activeProvider,
        ...(activeBotId ? { botId: activeBotId } : {}),
      },
      {
        onSuccess: (data) => {
          if (data?.qr) {
            setQrBase64(data.qr);
          }
          void refetch();
        },
        onError: (err) => {
          const message = err instanceof Error ? err.message : "Не удалось запустить подключение MAX";
          toast.error(message);
        },
      },
    );
  };

  // Автоматический запуск ровно один раз при открытии диалога
  useEffect(() => {
    if (open && !startedRef.current) {
      startedRef.current = true;
      const initialName = initialAccount?.label || "Основной";
      const initialProv = resolveInitialProvider(initialAccount);
      setAuthMode("qr");
      setProvider(initialProv);
      setName(initialName);
      setPassword("");
      setQrBase64(null);
      setPhoneStep("input");
      setPhone("");
      setSmsCode("");
      setPhoneAuthSessionId(null);
      setPhonePasswordHint(null);
      setPhoneError(null);
      setPhoneCaptchaBlocked(false);
      setPhoneUserLabel(null);
      handleStart(initialName, initialAccount?.id, initialProv);
    } else if (!open) {
      startedRef.current = false;
      setQrBase64(null);
      setPassword("");
      setPhoneStep("input");
      setSmsCode("");
      setPhoneError(null);
      setPhoneCaptchaBlocked(false);
    }
  }, [open, initialAccount]);

  const handleProviderChange = (nextProvider: MaxProviderType) => {
    if (nextProvider === provider) return;
    setProvider(nextProvider);
    if (authMode === "qr") {
      handleStart(name, initialAccount?.id, nextProvider);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setIsSubmittingPassword(true);
    try {
      await submitPassword.mutateAsync({
        name,
        password,
        provider,
        ...(initialAccount?.id ? { botId: initialAccount.id } : {}),
      });
      setPassword("");
      toast.success("Пароль отправлен, завершаем авторизацию...");
      void refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Неверный пароль 2FA";
      toast.error(message);
    } finally {
      setIsSubmittingPassword(false);
    }
  };

  const switchToQrTab = () => {
    setAuthMode("qr");
    setPhoneError(null);
    setPhoneCaptchaBlocked(false);
    if (!activeQr && !isPreparing && !isWaitingPassword && !isQrConnected) {
      handleStart(name, initialAccount?.id, provider);
    }
  };

  const handlePhoneStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setPhoneError(null);
    setPhoneCaptchaBlocked(false);
    try {
      const res = await startPhone.mutateAsync({
        phone,
        name: name.trim() || "Основной",
        ...(initialAccount?.id ? { botId: initialAccount.id } : {}),
      });
      setPhoneAuthSessionId(res.authSessionId);
      setPhoneHasCallTrack(res.hasCallTrack);
      setPhoneStep("code");
      toast.success("Запрос отправлен — введите код из SMS или подтвердите звонок в MAX");
    } catch (err) {
      const isCaptchaErr =
        (err instanceof ApiClientError && err.code === "MAX_CAPTCHA_REQUIRED") ||
        (err instanceof Error && /капч|Проверка не пройдена/i.test(err.message));
      const msg = isCaptchaErr
        ? "MAX запросил капчу VK (id.vk.ru), которая работает только на официальном домене web.max.ru. Подключите аккаунт по QR-коду."
        : err instanceof Error
          ? err.message
          : "Не удалось запросить код MAX";
      setPhoneCaptchaBlocked(isCaptchaErr);
      setPhoneError(msg);
      toast.error(msg);
    }
  };

  const handlePhoneVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneAuthSessionId || !smsCode.trim()) return;
    setPhoneError(null);
    try {
      const res = await verifyPhone.mutateAsync({
        authSessionId: phoneAuthSessionId,
        code: smsCode.trim(),
      });
      if (res.status === "waiting_password") {
        setPhonePasswordHint(res.passwordHint ?? null);
        setPhoneStep("password");
        return;
      }
      if (res.status === "authorized") {
        setPhoneUserLabel(res.user?.firstName || res.user?.username || phone);
        setPhoneStep("authorized");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Неверный код подтверждения";
      setPhoneError(msg);
      toast.error(msg);
    }
  };

  const handleCheckPhoneCall = async () => {
    if (!phoneAuthSessionId) return;
    setPhoneError(null);
    try {
      const res = await checkPhoneCall.mutateAsync({ authSessionId: phoneAuthSessionId });
      if (res.status === "waiting_password") {
        setPhonePasswordHint(res.passwordHint ?? null);
        setPhoneStep("password");
      } else if (res.status === "authorized") {
        setPhoneUserLabel(res.user?.firstName || res.user?.username || phone);
        setPhoneStep("authorized");
      } else {
        toast.info("Звонок ещё не подтверждён — дождитесь звонка или введите код из SMS");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Не удалось проверить статус звонка";
      setPhoneError(msg);
    }
  };

  const handlePhonePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneAuthSessionId || !password) return;
    setPhoneError(null);
    try {
      const res = await submitPhonePassword.mutateAsync({
        authSessionId: phoneAuthSessionId,
        password,
      });
      setPassword("");
      setPhoneUserLabel(res.user?.firstName || res.user?.username || phone);
      setPhoneStep("authorized");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Неверный облачный пароль 2FA";
      setPhoneError(msg);
      toast.error(msg);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} width="w-[520px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[#4a38f5]/10">
            <MessageSquare className="h-3.5 w-3.5 text-[#4a38f5]" />
          </div>
          <div>
            <h2 id="connect-max-title" className="text-sm font-semibold text-[#111111]">
              {initialAccount ? `Авторизация: ${initialAccount.label}` : "Подключить MAX"}
            </h2>
            <p className="text-[11px] text-[#666666]">
              Подключение личного аккаунта MAX по QR-коду или номеру телефона
            </p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="flex flex-col h-full bg-white text-[#111111]">
        {isConnected ? (
          <div className="flex flex-col items-center justify-center flex-1 p-6 space-y-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-[#111111]">Аккаунт MAX подключён!</h3>
              <p className="mt-1 text-xs text-[#666666]">
                {phoneUserLabel || statusData?.user?.firstName || statusData?.user?.username || name} успешно привязан.
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
        ) : isWaitingPassword ? (
          <form onSubmit={handlePasswordSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="flex gap-2.5 rounded-[8px] border border-sky-500/20 bg-sky-500/5 p-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                <p className="text-xs leading-relaxed text-[#666666]">
                  QR-код успешно отсканирован! У вашего аккаунта включена двухэтапная аутентификация в MAX. Введите облачный пароль для завершения подключения.
                  {statusData?.passwordHint && (
                    <>
                      {" "}
                      Подсказка:{" "}
                      <span className="font-medium text-[#111111]">
                        {statusData.passwordHint}
                      </span>
                    </>
                  )}
                </p>
              </div>

              {statusData?.error && (
                <div className="flex gap-2 rounded-[8px] border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{statusData.error}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[#666666]">
                  Облачный пароль 2FA
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoFocus
                  className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-[#e5e5e5] bg-white px-6 py-3 shrink-0">
              <button
                type="button"
                onClick={() => void handleStart()}
                className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#666666] hover:bg-[#fafafa] cursor-pointer"
              >
                Начать заново
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#fafafa] cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPassword || !password}
                  className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white transition-colors hover:bg-[#3d2ee0] disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingPassword ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Проверяем...
                    </>
                  ) : (
                    "Подтвердить пароль"
                  )}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Переключатель способа входа (QR / Телефон) */}
              <div className="grid grid-cols-2 gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-1">
                <button
                  type="button"
                  onClick={switchToQrTab}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                    authMode === "qr"
                      ? "bg-white text-[#111111] shadow-2xs border border-[#e5e5e5]"
                      : "text-[#666666] hover:text-[#111111]",
                  )}
                >
                  <QrCode className="h-3.5 w-3.5 text-[#4a38f5]" />
                  По QR-коду
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("phone");
                    setPhoneError(null);
                    setPhoneCaptchaBlocked(false);
                  }}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                    authMode === "phone"
                      ? "bg-white text-[#111111] shadow-2xs border border-[#e5e5e5]"
                      : "text-[#666666] hover:text-[#111111]",
                  )}
                >
                  <Phone className="h-3.5 w-3.5 text-[#4a38f5]" />
                  По телефону (SMS)
                </button>
              </div>

              {authMode === "qr" && (
                <div className="flex items-center justify-between gap-2 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] px-3 py-2">
                  <div>
                    <p className="text-[11px] font-medium text-[#111111]">Протокол подключения MAX</p>
                    <p className="text-[10px] text-[#666666]">
                      Нативный TS работает напрямую с web.max.ru (ver=10)
                    </p>
                  </div>
                  <div className="flex rounded-[6px] border border-[#e5e5e5] bg-white p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => handleProviderChange("native-ts")}
                      className={cn(
                        "rounded-[4px] px-2 py-1 font-medium transition-colors cursor-pointer",
                        provider === "native-ts"
                          ? "bg-[#4a38f5] text-white"
                          : "text-[#666666] hover:text-[#111111]",
                      )}
                    >
                      Нативный TS
                    </button>
                    <button
                      type="button"
                      onClick={() => handleProviderChange("max-bridge")}
                      className={cn(
                        "rounded-[4px] px-2 py-1 font-medium transition-colors cursor-pointer",
                        provider === "max-bridge"
                          ? "bg-[#4a38f5] text-white"
                          : "text-[#666666] hover:text-[#111111]",
                      )}
                    >
                      Bridge
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="max_name" className="block text-xs font-medium text-[#666666]">
                  Имя аккаунта в CRM
                </label>
                <div className="flex gap-2">
                  <input
                    id="max_name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Основной"
                    disabled={startQr.isPending || Boolean(initialAccount)}
                    className="h-8 flex-1 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 disabled:bg-[#fafafa] disabled:text-[#666666]"
                  />
                  {authMode === "qr" && (
                    <button
                      type="button"
                      onClick={() => void handleStart()}
                      disabled={startQr.isPending || !name.trim()}
                      className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] transition-colors hover:bg-[#fafafa] disabled:opacity-50 cursor-pointer"
                    >
                      {startQr.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Обновить QR
                    </button>
                  )}
                </div>
              </div>

              {authMode === "qr" ? (
                <>
                  {/* Блок QR-кода */}
                  <div className="flex flex-col items-center justify-center rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-6 min-h-[260px]">
                    {isPreparing ? (
                      <div className="flex h-56 flex-col items-center justify-center space-y-3">
                        <Loader2 className="h-8 w-8 animate-spin text-[#4a38f5]" />
                        <p className="text-xs text-[#666666]">Генерируем QR-код авторизации MAX...</p>
                      </div>
                    ) : isError ? (
                      <div className="flex h-56 flex-col items-center justify-center space-y-3 p-4 text-center">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-amber-600 border border-amber-200">
                          <AlertCircle className="h-5 w-5" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-[#111111]">
                            {statusData?.error?.includes("expired") || statusData?.error?.includes("истёк")
                              ? "Срок действия QR-кода истёк"
                              : "Ошибка подключения MAX"}
                          </p>
                          <p className="text-[11px] text-[#666666] max-w-xs">
                            {statusData?.error || "Не удалось получить QR-код или время ожидания истекло"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleStart()}
                          className="mt-2 flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 text-xs font-medium text-white transition-colors hover:bg-[#3d2ee0] cursor-pointer"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Сгенерировать новый QR
                        </button>
                      </div>
                    ) : activeQr ? (
                      <div className="space-y-3 text-center">
                        <div className="relative inline-block rounded-xl border border-[#e5e5e5] bg-white p-3 shadow-xs">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={activeQr}
                            alt="MAX QR Code"
                            className="h-52 w-52 object-contain"
                          />
                        </div>
                        <div className="flex items-center justify-center gap-2 text-xs text-[#666666]">
                          <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                          </span>
                          Ожидание сканирования в приложении MAX...
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-56 flex-col items-center justify-center space-y-3">
                        <QrCode className="h-10 w-10 text-[#888888]" />
                        <p className="text-xs text-[#666666]">
                          Нажмите «Обновить QR» для генерации кода
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Инструкция */}
                  <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 space-y-2.5">
                    <h4 className="text-xs font-semibold text-[#111111]">Как подключить:</h4>
                    <ol className="list-decimal pl-4 space-y-1.5 text-xs text-[#666666]">
                      <li>Откройте приложение <strong>MAX</strong> на вашем смартфоне.</li>
                      <li>Перейдите в <strong>Настройки</strong> → <strong>Устройства</strong>.</li>
                      <li>Нажмите <strong>Привязать устройство</strong> и отсканируйте этот QR-код.</li>
                    </ol>
                  </div>
                </>
              ) : phoneStep === "input" ? (
                <form onSubmit={handlePhoneStart} className="space-y-4 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-4">
                  <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-2.5 text-[11px] leading-relaxed text-[#666666]">
                    Сервер MAX защищает отправку SMS-кода капчей VK (<span className="font-mono text-[#111111]">id.vk.ru</span>), которая ограничена официальным доменом <span className="font-mono text-[#111111]">web.max.ru</span>. Основной и надёжный способ подключения — по QR-коду.
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="max_phone" className="block text-xs font-medium text-[#666666]">
                      Номер телефона MAX
                    </label>
                    <input
                      id="max_phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        if (phoneError) setPhoneError(null);
                        if (phoneCaptchaBlocked) setPhoneCaptchaBlocked(false);
                      }}
                      placeholder="+79991234567"
                      required
                      className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                    />
                  </div>
                  {phoneError && (
                    <div className="space-y-2 rounded-[8px] border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
                      <div className="flex gap-2">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{phoneError}</span>
                      </div>
                      {phoneCaptchaBlocked && (
                        <button
                          type="button"
                          onClick={switchToQrTab}
                          className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-rose-200 bg-white px-2.5 text-[11px] font-medium text-[#111111] hover:bg-[#fafafa] cursor-pointer"
                        >
                          <QrCode className="h-3.5 w-3.5 text-[#4a38f5]" />
                          Подключить по QR-коду
                        </button>
                      )}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={startPhone.isPending || !phone.trim()}
                    className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white transition-colors hover:bg-[#3d2ee0] disabled:opacity-50 cursor-pointer"
                  >
                    {startPhone.isPending ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Отправляем запрос...
                      </>
                    ) : (
                      "Получить код по SMS / звонку"
                    )}
                  </button>
                </form>
              ) : phoneStep === "code" ? (
                <form onSubmit={handlePhoneVerify} className="space-y-4 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-4">
                  <p className="text-xs text-[#666666]">
                    Введите код подтверждения для номера <span className="font-mono text-[#111111]">{phone}</span>.
                  </p>
                  <div className="space-y-1.5">
                    <label htmlFor="max_sms_code" className="block text-xs font-medium text-[#666666]">
                      Код из SMS / сообщения MAX
                    </label>
                    <input
                      id="max_sms_code"
                      value={smsCode}
                      onChange={(e) => setSmsCode(e.target.value)}
                      placeholder="123456"
                      autoFocus
                      className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                    />
                  </div>
                  {phoneError && (
                    <div className="flex gap-2 rounded-[8px] border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{phoneError}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="submit"
                      disabled={verifyPhone.isPending || !smsCode.trim()}
                      className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white transition-colors hover:bg-[#3d2ee0] disabled:opacity-50 cursor-pointer"
                    >
                      {verifyPhone.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        "Подтвердить код"
                      )}
                    </button>
                    {phoneHasCallTrack && (
                      <button
                        type="button"
                        onClick={() => void handleCheckPhoneCall()}
                        disabled={checkPhoneCall.isPending}
                        className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#f5f5f5] disabled:opacity-50 cursor-pointer"
                      >
                        {checkPhoneCall.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Проверить звонок
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setPhoneStep("input");
                        setSmsCode("");
                        setPhoneError(null);
                      }}
                      className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#666666] hover:bg-[#f5f5f5] cursor-pointer"
                    >
                      Другой номер
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handlePhonePasswordSubmit} className="space-y-4 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-4">
                  <div className="flex gap-2.5 rounded-[8px] border border-sky-500/20 bg-sky-500/5 p-3">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                    <p className="text-xs leading-relaxed text-[#666666]">
                      Код подтверждён! Введите облачный пароль 2FA вашего аккаунта MAX.
                      {phonePasswordHint && (
                        <>
                          {" "}
                          Подсказка: <span className="font-medium text-[#111111]">{phonePasswordHint}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoFocus
                    className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                  {phoneError && (
                    <div className="flex gap-2 rounded-[8px] border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{phoneError}</span>
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={submitPhonePassword.isPending || !password}
                    className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white transition-colors hover:bg-[#3d2ee0] disabled:opacity-50 cursor-pointer"
                  >
                    {submitPhonePassword.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Подтвердить пароль"
                    )}
                  </button>
                </form>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[#e5e5e5] bg-white px-6 py-3 shrink-0">
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
      </SheetContent>
    </Sheet>
  );
}
