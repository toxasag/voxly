"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, MessageSquare, QrCode, RefreshCw, ShieldCheck } from "lucide-react";

import { useMaxPassword, useMaxQrStatus, useMaxStartQr } from "@/lib/api/use-max-auth";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";

interface ConnectMaxModalProps {
  open: boolean;
  onClose: () => void;
}

export function ConnectMaxModal({ open, onClose }: ConnectMaxModalProps) {
  const [name, setName] = useState("Основной");
  const [password, setPassword] = useState("");
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);
  const startedRef = useRef(false);

  const startQr = useMaxStartQr();
  const submitPassword = useMaxPassword();

  const { data: statusData, refetch } = useMaxQrStatus(
    name,
    open && Boolean(name),
  );

  useEffect(() => {
    if (statusData?.qr) {
      setQrBase64(statusData.qr);
    }
  }, [statusData?.qr]);

  const isConnected = statusData?.status === "authorized";
  const isWaitingPassword = statusData?.status === "processing_password" || Boolean(statusData?.passwordHint);
  const activeQr = statusData?.qr || qrBase64;

  const handleStart = (customName?: string) => {
    const activeName = customName ?? name;
    setQrBase64(null);
    startQr.mutate(
      { name: activeName },
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
      setName("Основной");
      setPassword("");
      setQrBase64(null);
      handleStart("Основной");
    } else if (!open) {
      startedRef.current = false;
      setQrBase64(null);
    }
  }, [open]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setIsSubmittingPassword(true);
    try {
      await submitPassword.mutateAsync({ name, password });
      toast.success("Пароль отправлен, завершаем авторизацию...");
      void refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Неверный пароль 2FA";
      toast.error(message);
    } finally {
      setIsSubmittingPassword(false);
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
              Подключить MAX
            </h2>
            <p className="text-[11px] text-[#666666]">
              Авторизация личного аккаунта MAX через QR-код
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
                {statusData?.user?.firstName || statusData?.user?.username || name} успешно привязан.
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
                  У аккаунта включена двухэтапная аутентификация в MAX. Введите облачный пароль.
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

            <div className="flex items-center justify-end gap-2 border-t border-[#e5e5e5] bg-white px-6 py-3 shrink-0">
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
          </form>
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
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
                    disabled={startQr.isPending}
                    className="h-8 flex-1 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
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
                </div>
              </div>

              {/* Блок QR-кода */}
              <div className="flex flex-col items-center justify-center rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-6">
                {startQr.isPending && !activeQr ? (
                  <div className="flex h-52 flex-col items-center justify-center space-y-3">
                    <Loader2 className="h-8 w-8 animate-spin text-[#4a38f5]" />
                    <p className="text-xs text-[#666666]">Генерируем QR-код авторизации MAX...</p>
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
                  <div className="flex h-52 flex-col items-center justify-center space-y-3">
                    <QrCode className="h-10 w-10 text-[#888888]" />
                    <p className="text-xs text-[#666666]">
                      {statusData?.error ? statusData.error : "Нажмите «Обновить QR» для генерации кода"}
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
