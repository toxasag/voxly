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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[0.5px] p-4"
      onClick={backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="disable-module-title"
    >
      <div className="w-full max-w-md rounded-[16px] border border-[#e5e5e5] bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-[#e5e5e5] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-rose-500/10">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
            </div>
            <h2 id="disable-module-title" className="text-sm font-semibold text-[#111111]">
              Отключение модуля «{moduleName}»
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="Закрыть"
            className="rounded-[6px] p-1 text-[#888888] hover:bg-[#fafafa] hover:text-[#111111] transition-colors disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          {isLoading ? (
            <p className="flex items-center gap-2 text-xs text-[#666666]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Считаем, какие данные затронет отключение...
            </p>
          ) : loadError !== null ? (
            <p className="rounded-[8px] border border-rose-500/20 bg-rose-500/5 p-3 text-xs text-rose-600">
              {loadError}
            </p>
          ) : (
            <>
              <div className="flex gap-2.5 rounded-[8px] border border-rose-500/20 bg-rose-500/5 p-3">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" />
                <div className="space-y-1.5 text-xs leading-relaxed">
                  <p className="font-medium text-[#111111]">
                    {hasData
                      ? "Доступ к данным модуля будет закрыт"
                      : "Модуль будет отключён"}
                  </p>

                  {hasData ? (
                    <>
                      <p className="text-[#666666]">Скрыто будет:</p>
                      <ul className="space-y-0.5 text-[#111111]">
                        {entries.map(([table, count]) => (
                          <li key={table}>
                            • <span className="font-semibold">{count}</span>{" "}
                            {plural(count, TABLE_LABELS[table] ?? { one: table, few: table, many: table })}
                          </li>
                        ))}
                      </ul>
                      <p className="text-[#666666]">
                        Данные хранятся{" "}
                        <span className="font-semibold text-[#111111]">
                          {impact?.graceDays} {pluralDays(impact?.graceDays ?? 0)}
                        </span>{" "}
                        и вернутся, если подключить модуль обратно. После этого срока они
                        удаляются окончательно.
                      </p>
                    </>
                  ) : (
                    <p className="text-[#666666]">
                      Данных по этому модулю пока нет — терять нечего.
                    </p>
                  )}
                </div>
              </div>

              {hasData && (
                <p className="text-[11px] text-[#888888]">
                  Пробный период не начнётся заново при повторном подключении.
                </p>
              )}
            </>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-[#e5e5e5] pt-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#fafafa] transition-colors disabled:opacity-40"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => void onConfirm()}
              disabled={isPending || isLoading || loadError !== null}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-[8px] px-4 text-xs font-medium text-white transition-colors",
                "bg-rose-600 hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
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
