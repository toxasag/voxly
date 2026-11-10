"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  HelpCircle,
  Info,
  Loader2,
  RefreshCw,
  RotateCw,
  Search,
} from "lucide-react";
import {
  useBitrix24Logs,
  useRetryBitrix24Sync,
  type Bitrix24SyncLogDTO,
} from "@/lib/api/use-bitrix24";
import { toast } from "sonner";

interface Bitrix24SyncLogTableProps {
  onSelectDeal?: (dealId: string) => void;
}

export function Bitrix24SyncLogTable({ onSelectDeal }: Bitrix24SyncLogTableProps) {
  const [selectedLog, setSelectedLog] = useState<Bitrix24SyncLogDTO | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const { data, isLoading, isFetching, refetch } = useBitrix24Logs({ limit: 50 });
  const retryMutation = useRetryBitrix24Sync();

  const logs: Bitrix24SyncLogDTO[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.logs)
      ? data.logs
      : Array.isArray(data?.data)
        ? data.data
        : [];

  const handleRetry = async (log: Bitrix24SyncLogDTO) => {
    setRetryingId(log.id);
    try {
      const res = await retryMutation.mutateAsync(log.id);
      if (res.success) {
        toast.success(`Сделка успешно экспортирована в Битрикс24 (Лид ID: ${res.leadId})`);
      } else {
        toast.error(res.error || "Ошибка повторной отправки в Битрикс24");
      }
    } catch (err: unknown) {
      const anyErr = err as { message?: string; data?: { message?: string } };
      toast.error(anyErr.data?.message || anyErr.message || "Сбой повторной синхронизации");
    } finally {
      setRetryingId(null);
    }
  };

  const formatDateTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-3">
      {/* Тулбар журнала */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#111111]">
            История синхронизаций с Битрикс24
          </span>
          <span className="text-[11px] text-[#666666] bg-[#f5f5f5] px-2 py-0.5 rounded-[4px] font-mono">
            Всего: {data?.total ?? logs.length}
          </span>
        </div>

        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-7 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#111111] transition-colors hover:bg-[#f5f5f5] hover:border-[#cccccc] inline-flex items-center gap-1.5 disabled:opacity-50"
          title="Обновить журнал"
        >
          <RefreshCw className={`h-3 w-3 text-[#666666] ${isFetching ? "animate-spin text-[#4a38f5]" : ""}`} />
          <span>Обновить</span>
        </button>
      </div>

      {/* Таблица логов */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#e5e5e5] bg-[#fbfbfb] text-[11px] font-semibold text-[#666666]">
                <th className="py-2.5 px-3">Дата / Время</th>
                <th className="py-2.5 px-3">Сделка и контакт</th>
                <th className="py-2.5 px-3">Источник</th>
                <th className="py-2.5 px-3">Статус в Битрикс24</th>
                <th className="py-2.5 px-3 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f0]">
              {isLoading && logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[#888888]">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-[#4a38f5]" />
                      <span>Загрузка журнала отправок...</span>
                    </div>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[#888888]">
                    <div className="max-w-sm mx-auto space-y-1">
                      <p className="font-medium text-[#111111]">Журнал отправок пуст</p>
                      <p className="text-[11px] text-[#666666]">
                        Новые заявки автоматически регистрируются в этом списке сразу при поступлении в CRM.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const isRetrying = retryingId === log.id;
                  return (
                    <tr key={log.id} className="hover:bg-[#fafafa] transition-colors">
                      {/* Дата / Время */}
                      <td className="py-2.5 px-3 font-mono text-[11px] text-[#555555] whitespace-nowrap">
                        {formatDateTime(log.created_at)}
                      </td>

                      {/* Сделка и контакт */}
                      <td className="py-2.5 px-3 min-w-[200px]">
                        <div className="font-medium text-[#111111] truncate max-w-[240px]">
                          {log.deal_title || (log.deal_id ? `Сделка #${log.deal_id.slice(0, 8)}` : "Без сделки")}
                        </div>
                        <div className="text-[11px] text-[#666666] flex items-center gap-1.5 mt-0.5">
                          {log.contact_name && <span>{log.contact_name}</span>}
                          {log.contact_phone && (
                            <>
                              <span>•</span>
                              <span className="font-mono">{log.contact_phone}</span>
                            </>
                          )}
                          {log.deal_id && onSelectDeal && (
                            <button
                              type="button"
                              onClick={() => onSelectDeal(log.deal_id!)}
                              className="text-[#4a38f5] hover:underline inline-flex items-center gap-0.5 ml-1"
                              title="Открыть карточку сделки"
                            >
                              <ExternalLink className="h-2.5 w-2.5" />
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Источник */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#f5f5f5] px-2 py-0.5 text-[11px] text-[#444444] border border-[#e5e5e5]">
                          {log.widget_name || log.lead_source || "Веб-виджет"}
                        </span>
                      </td>

                      {/* Статус */}
                      <td className="py-2.5 px-3">
                        {log.status === "success" && (
                          <div className="inline-flex items-center gap-1.5 rounded-[4px] bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                            <span>Доставлено</span>
                            {log.bitrix_lead_id && (
                              <span className="font-mono font-semibold">ID: {log.bitrix_lead_id}</span>
                            )}
                          </div>
                        )}

                        {log.status === "error" && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="inline-flex items-center gap-1 rounded-[4px] bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-800 border border-rose-200">
                              <AlertCircle className="h-3 w-3 text-rose-600 shrink-0" />
                              <span>Ошибка {log.response_status ? `(HTTP ${log.response_status})` : ""}</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => setSelectedLog(log)}
                              className="text-[10px] text-rose-700 underline hover:text-rose-900"
                            >
                              Причина
                            </button>
                          </div>
                        )}

                        {log.status === "skipped" && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#f5f5f5] px-2 py-0.5 text-[11px] text-[#666666] border border-[#e5e5e5]">
                              <Clock className="h-3 w-3 text-[#888888] shrink-0" />
                              <span>Пропущен фильтром</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => setSelectedLog(log)}
                              className="text-[10px] text-[#666666] underline hover:text-[#111111]"
                            >
                              Инфо
                            </button>
                          </div>
                        )}

                        {log.status === "pending" && (
                          <span className="inline-flex items-center gap-1 rounded-[4px] bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 border border-amber-200">
                            <Loader2 className="h-3 w-3 animate-spin text-amber-600" />
                            <span>В очереди...</span>
                          </span>
                        )}
                      </td>

                      {/* Действия (Retry) */}
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedLog(log)}
                            className="h-6 px-2 rounded-[4px] border border-[#e5e5e5] bg-white text-[11px] font-medium text-[#444444] transition-colors hover:bg-[#f5f5f5] hover:border-[#cccccc]"
                            title="Посмотреть JSON ответа и детали"
                          >
                            Детали
                          </button>

                          {(log.status === "error" || log.status === "skipped" || log.status === "success") && log.deal_id && (
                            <button
                              type="button"
                              disabled={isRetrying}
                              onClick={() => handleRetry(log)}
                              className="h-6 px-2 rounded-[4px] border border-[#e5e5e5] bg-white text-[11px] font-medium text-[#111111] transition-colors hover:bg-[#f5f5f5] hover:border-[#cccccc] inline-flex items-center gap-1 disabled:opacity-40"
                              title="Отправить лид в Битрикс24 повторно"
                            >
                              {isRetrying ? (
                                <Loader2 className="h-3 w-3 animate-spin text-[#4a38f5]" />
                              ) : (
                                <RotateCw className="h-3 w-3 text-[#666666]" />
                              )}
                              <span>Повторить</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Модальное окно просмотра деталей ошибки или payload */}
      {selectedLog && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
          onClick={() => setSelectedLog(null)}
        >
          <div
            className="w-full max-w-lg rounded-[16px] border border-[#e5e5e5] bg-white shadow-2xl p-5 space-y-4 max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#e5e5e5] pb-3 flex-shrink-0">
              <div>
                <h3 className="text-sm font-semibold text-[#111111]">
                  Детали отправки лида в Битрикс24
                </h3>
                <p className="text-[11px] text-[#666666]">
                  {formatDateTime(selectedLog.created_at)} • Статус: {selectedLog.status.toUpperCase()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="rounded-[6px] p-1 text-[#888888] hover:bg-[#f5f5f5] hover:text-[#111111]"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs">
              {selectedLog.error_message && (
                <div className="rounded-[8px] border border-rose-200 bg-rose-50 p-3 space-y-1">
                  <p className="font-semibold text-rose-900">Сообщение / Ошибка:</p>
                  <p className="text-rose-800 break-words font-mono text-[11px]">
                    {selectedLog.error_message}
                  </p>
                </div>
              )}

              {selectedLog.bitrix_lead_id && (
                <div className="rounded-[8px] border border-emerald-200 bg-emerald-50 p-3 space-y-1">
                  <p className="font-semibold text-emerald-900">Идентификатор в CRM:</p>
                  <p className="text-emerald-800 font-mono text-[11px]">
                    Создан лид ID: {selectedLog.bitrix_lead_id}
                  </p>
                </div>
              )}

              {selectedLog.response_body && (
                <div>
                  <p className="font-medium text-[#111111] mb-1">Ответ Битрикс24 (Response):</p>
                  <pre className="rounded-[8px] bg-[#f8f8f8] border border-[#e5e5e5] p-2.5 font-mono text-[11px] text-[#222222] overflow-x-auto max-h-40">
                    {JSON.stringify(selectedLog.response_body, null, 2)}
                  </pre>
                </div>
              )}

              {selectedLog.request_payload && (
                <div>
                  <p className="font-medium text-[#111111] mb-1">Полезная нагрузка (Payload):</p>
                  <pre className="rounded-[8px] bg-[#f8f8f8] border border-[#e5e5e5] p-2.5 font-mono text-[11px] text-[#222222] overflow-x-auto max-h-40">
                    {JSON.stringify(selectedLog.request_payload, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#e5e5e5] flex-shrink-0">
              {selectedLog.deal_id && (
                <button
                  type="button"
                  disabled={retryingId === selectedLog.id}
                  onClick={() => handleRetry(selectedLog)}
                  className="h-8 rounded-[8px] bg-[#4a38f5] px-3 text-xs font-medium text-white transition-colors hover:bg-[#3d2ee0] inline-flex items-center gap-1.5"
                >
                  {retryingId === selectedLog.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCw className="h-3 w-3" />
                  )}
                  <span>Повторить отправку</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#444444] transition-colors hover:bg-[#fafafa]"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
