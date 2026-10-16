"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { apiClient, ApiClientError } from "@/lib/api/apiClient";
import { cn } from "@/lib/utils";
import { useOverlay } from "@/lib/utils/use-scroll-lock";

// ---------------------------------------------------------------------------
// Подтверждение отключения модуля.
//
// Отдельный компонент, а не общий ConfirmDialog: текст должен называть, что
// именно потеряется — число заказ-нарядов, счетов, транзакций. Абстрактное
// «данные будут заблокированы» заставляет решать вслепую, а числа приходят с
// сервера и до их загрузки кнопка подтверждения недоступна.
// ---------------------------------------------------------------------------

interface ImpactDTO {
  slug: string;
  isBaseModule: boolean;
  /** Сколько строк затронет отключение, по таблицам. */
  affected: Record<string, number>;
  total: number;
  /** Сколько дней данные хранятся до окончательной очистки. */
  graceDays: number;
}

/** Русские названия таблиц: `repair_orders` в диалоге ничего не объясняет. */
const TABLE_LABELS: Record<string, { one: string; few: string; many: string }> = {
  repair_orders: { one: "заказ-наряд", few: "заказ-наряда", many: "заказ-нарядов" },
  invoices: { one: "счёт", few: "счёта", many: "счетов" },
  transactions: { one: "операция", few: "операции", many: "операций" },
  cash_accounts: { one: "касса", few: "кассы", many: "касс" },
};

function plural(count: number, forms: { one: string; few: string; many: string }): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return forms.one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms.few;
  return forms.many;
}

function pluralDays(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
}

interface DisableModuleDialogProps {
  open: boolean;
  moduleName: string;
  moduleSlug: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  isPending: boolean;
}

export function DisableModuleDialog({
  open,
  moduleName,
  moduleSlug,
  onClose,
  onConfirm,
  isPending,
}: DisableModuleDialogProps) {
  const [impact, setImpact] = useState<ImpactDTO | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Единый стек оверлеев. Закрывает два дефекта разом: прямая правка
  // `body.style.overflow` возвращала прокрутку фону при закрытии верхнего из
  // нескольких оверлеев, а собственный слушатель Escape закрывал их все сразу.
  useOverlay(open, { onEscape: onClose, disabled: isPending });

  // Данные запрашиваются при открытии, а не при загрузке маркетплейса: подсчёт
  // строк по таблицам нужен только здесь, и делать его для каждой карточки
  // заранее было бы напрасной работой.
  useEffect(() => {
    if (!open) {
      setImpact(null);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    void (async () => {
      try {
        const res = await apiClient.get<ImpactDTO>(
          `/api/v1/marketplace/modules/${moduleSlug}/impact`,
        );
        if (!cancelled) setImpact(res.data);
      } catch (error) {
        if (cancelled) return;
        setLoadError(
          error instanceof ApiClientError
            ? error.message
            : "Не удалось узнать, какие данные затронет отключение",
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, moduleSlug]);


  const backdrop = useCallback(
    (event: React.MouseEvent) => {
      if (event.target === event.currentTarget && !isPending) onClose();
    },
    [onClose, isPending],
  );

  if (!open) return null;

  const entries = Object.entries(impact?.affected ?? {});
  const hasData = (impact?.total ?? 0) > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="disable-module-title"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-500/10">
              <AlertTriangle className="h-4 w-4 text-rose-400" />
            </div>
            <h2 id="disable-module-title" className="text-sm font-semibold text-slate-100">
              Отключение модуля «{moduleName}»
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="Закрыть"
            className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          {isLoading ? (
            <p className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Считаем, какие данные затронет отключение...
            </p>
          ) : loadError !== null ? (
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-400">
              {loadError}
            </p>
          ) : (
            <>
              <div className="flex gap-3 rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                <div className="space-y-2 text-xs leading-relaxed">
                  <p className="text-sm font-medium text-slate-100">
                    {hasData
                      ? "Доступ к данным модуля будет закрыт"
                      : "Модуль будет отключён"}
                  </p>

                  {hasData ? (
                    <>
                      <p className="text-slate-400">Скрыто будет:</p>
                      <ul className="space-y-0.5 text-slate-300">
                        {entries.map(([table, count]) => (
                          <li key={table}>
                            • <span className="font-semibold">{count}</span>{" "}
                            {plural(count, TABLE_LABELS[table] ?? { one: table, few: table, many: table })}
                          </li>
                        ))}
                      </ul>
                      {/*
                        Точные условия вместо расплывчатого «данные будут
                        удалены»: они хранятся ограниченное время и возвращаются
                        при повторном подключении — пользователь должен понимать,
                        что именно произойдёт и что действие обратимо.
                      */}
                      <p className="text-slate-400">
                        Данные хранятся{" "}
                        <span className="font-semibold text-slate-200">
                          {impact?.graceDays} {pluralDays(impact?.graceDays ?? 0)}
                        </span>{" "}
                        и вернутся, если подключить модуль обратно. После этого срока они
                        удаляются окончательно.
                      </p>
                    </>
                  ) : (
                    <p className="text-slate-400">
                      Данных по этому модулю пока нет — терять нечего.
                    </p>
                  )}
                </div>
              </div>

              {hasData && (
                <p className="text-xs text-slate-500">
                  Пробный период не начнётся заново при повторном подключении.
                </p>
              )}
            </>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => void onConfirm()}
              // Кнопка недоступна, пока не известны последствия: подтверждать
              // вслепую то, что затрагивает данные, нельзя.
              disabled={isPending || isLoading || loadError !== null}
              className={cn(
                "flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-colors",
                "bg-rose-600 hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Отключаем...
                </>
              ) : (
                "Да, отключить"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
