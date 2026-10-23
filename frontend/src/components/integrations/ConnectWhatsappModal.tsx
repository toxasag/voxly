"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Loader2, MessageSquare, QrCode, RefreshCw } from "lucide-react";

import { useWhatsappQrStatus, useWhatsappStartQr } from "@/lib/api/use-whatsapp-auth";
import { channelKeys } from "@/lib/api/use-channels";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";

interface ConnectWhatsappModalProps {
  open: boolean;
  onClose: () => void;
}

export function ConnectWhatsappModal({ open, onClose }: ConnectWhatsappModalProps) {
  const [label, setLabel] = useState("Основной");
  const [instanceName, setInstanceName] = useState<string | null>(null);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const startedRef = useRef(false);

  const queryClient = useQueryClient();
  const startQr = useWhatsappStartQr();
  const { data: statusData } = useWhatsappQrStatus(
    instanceName,
    label,
    open && Boolean(instanceName),
  );

  const isConnected = statusData?.status === "connected";

  const handleStart = useCallback((customLabel?: string) => {
    const activeLabel = customLabel ?? label;
    setQrBase64(null);
    startQr.mutate(
      { label: activeLabel },
      {
        onSuccess: (res) => {
          setInstanceName(res.instanceName);
          if (res.qr) {
            setQrBase64(res.qr);
          }
        },
        onError: (err) => {
          const message = err instanceof Error ? err.message : "Не удалось запустить подключение WhatsApp";
          toast.error(message);
        },
      },
    );
  }, [label, startQr]);

  // Автоматический старт ровно один раз при открытии диалога
  useEffect(() => {
    if (open && !startedRef.current) {
      startedRef.current = true;
      setLabel("Основной");
      setInstanceName(null);
      setQrBase64(null);
      handleStart("Основной");
    } else if (!open) {
      startedRef.current = false;
      setInstanceName(null);
      setQrBase64(null);
    }
  }, [open, handleStart]);

  // Обновляем QR при получении из статуса
  useEffect(() => {
    if (statusData?.qr) {
      setQrBase64(statusData.qr);
    }
  }, [statusData?.qr]);

  useEffect(() => {
    if (statusData?.status === "connected") {
      void queryClient.invalidateQueries({ queryKey: channelKeys.accounts("whatsapp") });
      toast.success(`WhatsApp номер ${statusData.phone ?? ""} успешно подключён!`);
    }
  }, [statusData?.status, statusData?.phone, queryClient]);

  return (
    <Sheet open={open} onClose={onClose} width="w-[520px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-emerald-50 border border-emerald-200">
            <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
          </div>
          <div>
            <h2 id="connect-whatsapp-title" className="text-sm font-semibold text-[#111111]">
              Подключить WhatsApp
            </h2>
            <p className="text-[11px] text-[#666666]">
              Авторизация личного или бизнес-номера через QR-код
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
              <h3 className="text-base font-semibold text-[#111111]">WhatsApp подключён!</h3>
              <p className="mt-1 text-xs text-[#666666] max-w-sm">
                Номер {statusData?.phone} успешно связан с системой. Входящие и исходящие сообщения теперь синхронизируются.
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
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="space-y-1.5">
                <label htmlFor="wa_label" className="block text-xs font-medium text-[#666666]">
                  Название подключения
                </label>
                <div className="flex gap-2">
                  <input
                    id="wa_label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Например, Основной или Отдел продаж"
                    disabled={startQr.isPending}
                    className="h-8 flex-1 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                  <button
                    type="button"
                    onClick={() => handleStart()}
                    disabled={startQr.isPending || !label.trim()}
                    className="flex h-8 items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] transition-colors hover:bg-[#fafafa] disabled:opacity-50 cursor-pointer"
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
                        alt="WhatsApp QR Code"
                        className="h-52 w-52 object-contain"
                      />
                    </div>
                    <div className="flex items-center justify-center gap-2 text-xs text-[#666666]">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                      </span>
                      Ожидание сканирования камерой WhatsApp...
                    </div>
                  </div>
                ) : (
                  <div className="flex h-52 flex-col items-center justify-center space-y-3">
                    <QrCode className="h-10 w-10 text-[#888888]" />
                    <p className="text-xs text-[#666666]">Нажмите «Обновить QR», чтобы получить код</p>
                  </div>
                )}
              </div>

              {/* Пошаговая инструкция */}
              <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 space-y-2.5">
                <h4 className="text-xs font-semibold text-[#111111]">Как подключить:</h4>
                <ol className="list-decimal pl-4 space-y-1.5 text-xs text-[#666666]">
                  <li>Откройте <strong>WhatsApp</strong> на вашем смартфоне.</li>
                  <li>
                    Перейдите в <strong>Настройки</strong> (на iOS) или нажмите на <strong>три точки</strong> (на Android).
                  </li>
                  <li>
                    Выберите <strong>Связанные устройства</strong> → <strong>Привязка устройства</strong>.
                  </li>
                  <li>Наведите камеру смартфона на этот экран и отсканируйте QR-код.</li>
                </ol>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[#e5e5e5] bg-white px-6 py-3.5 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="h-8 rounded-[6px] border border-[#e5e5e5] bg-white px-3.5 text-xs font-medium text-[#111111] hover:bg-[#fafafa] cursor-pointer"
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
