"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Sparkles, TrendingDown, Wallet } from "lucide-react";

import { ApiClientError } from "@/lib/api/apiClient";
import { useAuth } from "@/lib/auth/use-auth";
import {
  formatKopecks,
  useAiBalance,
  useTopupAiBalance,
} from "@/lib/api/use-ai-agents";
import { Skeleton } from "@/components/shared/Skeleton";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Баланс ИИ.
//
// Отдельный блок от абонентской платы, потому что это разные деньги: подписка —
// фиксированный ежемесячный платёж за модули и каналы, баланс ИИ — предоплаченный
// расход по факту использования моделей. В одном блоке пользователь не понимал бы,
// почему «к оплате 1500 ₽», но с него ещё и списывают за токены.
// ---------------------------------------------------------------------------

/** Готовые суммы пополнения. Совпадают с требованием задания. */
const TOPUP_PRESETS = [500, 1000, 5000] as const;

const numberFormatter = new Intl.NumberFormat("ru-RU");

export function AiBalanceCard() {
  const { user } = useAuth();
  const canCreditManually = user?.platform_role === "platform_owner";
  const balance = useAiBalance();
  const topup = useTopupAiBalance();
  const [selected, setSelected] = useState<number>(TOPUP_PRESETS[1]);
  const [formOpen, setFormOpen] = useState(false);

  const handleTopup = useCallback(async () => {
    try {
      const result = await topup.mutateAsync({ amountRubles: selected });
      toast.success(
        `Баланс пополнен на ${formatKopecks(selected * 100)}. Текущий остаток: ${formatKopecks(result.balanceKopecks)}`,
      );
      setFormOpen(false);
    } catch (error) {
      if (error instanceof ApiClientError) {
        toast.error(error.message);
        return;
      }
      toast.error("Нет связи с сервером. Повторите попытку.");
    }
  }, [topup, selected]);

  if (balance.isLoading) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }

  // 403 — у роли нет billing:manage. Блок просто не показывается: он про деньги,
  // и заглушка «нет доступа» в разделе оплаты только мешала бы.
  if (balance.isError && balance.error.status === 403) return null;

  if (balance.isError || balance.data === undefined) {
    return (
      <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6">
        <p className="text-sm text-rose-400">
          Не удалось загрузить баланс ИИ: {balance.error?.message ?? "неизвестная ошибка"}
        </p>
        <button
          type="button"
          onClick={() => void balance.refetch()}
          className="mt-3 rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
        >
          Повторить
        </button>
      </div>
    );
  }

  const data = balance.data;
  const isLow = data.balanceKopecks < 50_000; // меньше 500 ₽

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-400" />
            <p className="text-xs uppercase tracking-wider text-slate-500">Баланс ИИ</p>
          </div>

          <p
            className={cn(
              "mt-1.5 text-3xl font-bold",
              isLow ? "text-amber-400" : "text-slate-100",
            )}
          >
            {formatKopecks(data.balanceKopecks)}
          </p>

          <p className="mt-1 text-xs text-slate-500">
            {/*
              Остаток в токенах — оценка по недорогой модели, а не гарантия:
              цена 1k токенов различается между моделями в десятки раз.
            */}
            ≈ {numberFormatter.format(data.estimatedTokensLeft)} токенов на GPT-4o mini
          </p>

          {isLow && (
            <p className="mt-2 text-xs text-amber-400">
              Баланс заканчивается — агенты перестанут отвечать при нулевом остатке.
            </p>
          )}
        </div>

        <div className="text-right">
          <p className="flex items-center justify-end gap-1.5 text-xs uppercase tracking-wider text-slate-500">
            <TrendingDown className="h-3.5 w-3.5" />
            Расход за месяц
          </p>
          <p className="mt-1.5 text-2xl font-bold text-slate-100">
            {formatKopecks(data.spentThisMonthKopecks)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {numberFormatter.format(data.requestsThisMonth)} запросов · всего{" "}
            {formatKopecks(data.spentTotalKopecks)}
          </p>
        </div>
      </div>

      {!canCreditManually ? (
        <p className="mt-5 text-sm text-slate-400">
          Онлайн-оплата пока не подключена. Для пополнения обратитесь к администратору платформы.
        </p>
      ) : !formOpen ? (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="mt-5 flex items-center gap-2 rounded-lg bg-[#4a38f5] px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#3b2be0]"
        >
          <Wallet className="h-4 w-4" />
          Начислить вручную (администратор)
        </button>
      ) : (
        <div className="mt-5 border-t border-slate-800 pt-5">
          <p className="text-xs font-medium text-slate-400">Сумма пополнения</p>

          <div className="mt-2.5 flex flex-wrap gap-2">
            {TOPUP_PRESETS.map((amount) => (
              <button
                key={amount}
                type="button"
                onClick={() => setSelected(amount)}
                aria-pressed={selected === amount}
                className={cn(
                  "rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors",
                  selected === amount
                    ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                    : "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200",
                )}
              >
                {numberFormatter.format(amount)} ₽
              </button>
            ))}
          </div>

          {/*
            Платёжного провайдера в проекте нет, поэтому пополнение начисляет сумму
            напрямую и попадает в журнал как ручная операция. Говорим об этом
            прямо: кнопка «Оплатить картой», ведущая в никуда, была бы хуже.
          */}
          <p className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs leading-relaxed text-slate-500">
            Онлайн-оплата пока не подключена: сумма зачисляется на баланс сразу, счёт
            выставляется вручную. Операция попадает в журнал пополнений.
          </p>

          <div className="mt-4 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              disabled={topup.isPending}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => void handleTopup()}
              disabled={topup.isPending}
              className="flex items-center gap-2 rounded-lg bg-[#4a38f5] px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#3b2be0] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {topup.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Зачисляем...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Пополнить на {numberFormatter.format(selected)} ₽
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
