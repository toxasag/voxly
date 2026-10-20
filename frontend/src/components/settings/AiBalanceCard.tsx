"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CreditCard, ExternalLink, Loader2, Plus, Sparkles, TrendingDown, Wallet } from "lucide-react";

import { ApiClientError } from "@/lib/api/apiClient";
import { useAuth } from "@/lib/auth/use-auth";
import {
  formatKopecks,
  useAiBalance,
  useTopupAiBalance,
} from "@/lib/api/use-ai-agents";
import { useMarketplaceBilling } from "@/lib/api/use-marketplace";
import { useCreateCheckout } from "@/lib/api/use-billing-checkout";
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
  const billing = useMarketplaceBilling();
  const checkout = useCreateCheckout();

  const [selected, setSelected] = useState<number>(TOPUP_PRESETS[1]);
  const [formOpen, setFormOpen] = useState(false);
  const [paymentMode, setPaymentMode] = useState<"checkout" | "manual">("checkout");

  const isProviderConnected = Boolean(billing.data?.billingProvider?.connected);

  const handleManualTopup = useCallback(async () => {
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

  const handleOnlineCheckout = useCallback(async () => {
    try {
      toast.info("Формируем защищённую ссылку для оплаты...");
      const result = await checkout.mutateAsync({
        amount_rubles: selected,
        product_code: "ai_balance_topup",
        description: `Пополнение баланса ИИ на ${selected} ₽`,
      });

      if (result.paymentUrl) {
        window.location.href = result.paymentUrl;
      } else {
        toast.error("Платёжная ссылка не получена от шлюза.");
      }
    } catch (error) {
      if (error instanceof ApiClientError) {
        toast.error(error.message);
        return;
      }
      toast.error("Не удалось сформировать платёж. Проверьте настройки Robokassa.");
    }
  }, [checkout, selected]);

  if (balance.isLoading) {
    return <Skeleton className="h-40 w-full rounded-[8px]" />;
  }

  // 403 — у роли нет billing:manage. Блок просто не показывается.
  if (balance.isError && balance.error.status === 403) return null;

  if (balance.isError || balance.data === undefined) {
    return (
      <div role="alert" className="rounded-[8px] border border-rose-200 bg-rose-50 p-6">
        <p className="text-sm text-rose-700">
          Не удалось загрузить баланс ИИ: {balance.error?.message ?? "неизвестная ошибка"}
        </p>
        <button
          type="button"
          onClick={() => void balance.refetch()}
          className="mt-3 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] hover:bg-[#fafafa]"
        >
          Повторить
        </button>
      </div>
    );
  }

  const data = balance.data;
  const isLow = data.balanceKopecks < 50_000; // меньше 500 ₽

  return (
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 shadow-2xs">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#4a38f5]" />
            <p className="text-xs uppercase tracking-wider text-[#666666]">Баланс ИИ</p>
          </div>

          <p
            className={cn(
              "mt-1.5 text-3xl font-bold font-mono tabular-nums",
              isLow ? "text-[#854d0e]" : "text-[#111111]",
            )}
          >
            {formatKopecks(data.balanceKopecks)}
          </p>

          <p className="mt-1 text-xs text-[#888888]">
            ≈ {numberFormatter.format(data.estimatedTokensLeft)} токенов на GPT-4o mini
          </p>

          {isLow && (
            <p className="mt-2 text-xs font-medium text-[#854d0e]">
              Баланс заканчивается — агенты перестанут отвечать при нулевом остатке.
            </p>
          )}
        </div>

        <div className="text-right">
          <p className="flex items-center justify-end gap-1.5 text-xs uppercase tracking-wider text-[#666666]">
            <TrendingDown className="h-3.5 w-3.5" />
            Расход за месяц
          </p>
          <p className="mt-1.5 text-2xl font-bold text-[#111111] font-mono tabular-nums">
            {formatKopecks(data.spentThisMonthKopecks)}
          </p>
          <p className="mt-1 text-xs text-[#888888]">
            {numberFormatter.format(data.requestsThisMonth)} запросов · всего{" "}
            {formatKopecks(data.spentTotalKopecks)}
          </p>
        </div>
      </div>

      {!formOpen ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {isProviderConnected ? (
            <button
              type="button"
              onClick={() => {
                setPaymentMode("checkout");
                setFormOpen(true);
              }}
              className="flex items-center gap-2 rounded-[8px] bg-[#4a38f5] px-4 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0]"
            >
              <CreditCard className="h-4 w-4" />
              Пополнить баланс картой
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-sm text-[#666666]">
              <span>Онлайн-оплата временно недоступна.</span>
              {canCreditManually && (
                <Link
                  href="/admin/integrations"
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#4a38f5] hover:underline"
                >
                  Настроить Robokassa в админке
                  <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </div>
          )}

          {canCreditManually && (
            <button
              type="button"
              onClick={() => {
                setPaymentMode("manual");
                setFormOpen(true);
              }}
              className="flex items-center gap-2 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-xs font-medium text-[#111111] shadow-2xs transition-colors hover:bg-[#fafafa]"
            >
              <Wallet className="h-3.5 w-3.5 text-[#666666]" />
              Прямое начисление (админ)
            </button>
          )}
        </div>
      ) : (
        <div className="mt-5 border-t border-[#e5e5e5] pt-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-[#666666]">
              {paymentMode === "checkout" ? "Оплата через Robokassa" : "Прямое зачисление администратором"}
            </p>
            {canCreditManually && isProviderConnected && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMode("checkout")}
                  className={cn(
                    "text-xs px-2 py-1 rounded-[4px] transition-colors",
                    paymentMode === "checkout" ? "bg-[#4a38f5]/10 font-semibold text-[#4a38f5]" : "text-[#666666] hover:text-[#111111]"
                  )}
                >
                  Картой
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMode("manual")}
                  className={cn(
                    "text-xs px-2 py-1 rounded-[4px] transition-colors",
                    paymentMode === "manual" ? "bg-[#4a38f5]/10 font-semibold text-[#4a38f5]" : "text-[#666666] hover:text-[#111111]"
                  )}
                >
                  Вручную
                </button>
              </div>
            )}
          </div>

          <div className="mt-2.5 flex flex-wrap gap-2">
            {TOPUP_PRESETS.map((amount) => (
              <button
                key={amount}
                type="button"
                onClick={() => setSelected(amount)}
                aria-pressed={selected === amount}
                className={cn(
                  "rounded-[8px] border px-4 py-2 text-sm font-medium transition-colors font-mono tabular-nums",
                  selected === amount
                    ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                    : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                )}
              >
                {numberFormatter.format(amount)} ₽
              </button>
            ))}
          </div>

          {paymentMode === "checkout" ? (
            <p className="mt-3 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 text-xs leading-relaxed text-[#666666]">
              Вы будете перенаправлены на защищённую страницу Robokassa. Принимаются банковские карты МИР, Visa, Mastercard, а также СБП. Средства зачисляются мгновенно.
            </p>
          ) : (
            <p className="mt-3 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 text-xs leading-relaxed text-[#666666]">
              Прямое начисление администратором: баланс увеличится сразу без обращения к платёжному шлюзу.
            </p>
          )}

          <div className="mt-4 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              disabled={checkout.isPending || topup.isPending}
              className="rounded-[8px] px-3 py-1.5 text-xs font-medium text-[#666666] transition-colors hover:bg-[#fafafa] hover:text-[#111111] disabled:opacity-40"
            >
              Отмена
            </button>
            {paymentMode === "checkout" ? (
              <button
                type="button"
                onClick={() => void handleOnlineCheckout()}
                disabled={checkout.isPending}
                className="flex items-center gap-2 rounded-[8px] bg-[#4a38f5] px-4 py-2 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {checkout.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Перенаправляем...
                  </>
                ) : (
                  <>
                    <CreditCard className="h-3.5 w-3.5" />
                    Оплатить {numberFormatter.format(selected)} ₽
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleManualTopup()}
                disabled={topup.isPending}
                className="flex items-center gap-2 rounded-[8px] bg-[#4a38f5] px-4 py-2 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {topup.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Зачисляем...
                  </>
                ) : (
                  <>
                    <Plus className="h-3.5 w-3.5" />
                    Начислить {numberFormatter.format(selected)} ₽
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

