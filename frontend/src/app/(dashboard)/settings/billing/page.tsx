"use client";

import { useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowUpRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  CreditCard,
  Gift,
  Info,
  Receipt,
  ShoppingBag,
  Sparkles,
  Users,
  XCircle,
} from "lucide-react";
import { AiBalanceCard } from "@/components/settings/AiBalanceCard";
import { Guard } from "@/components/shared/Guard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  formatRub,
  pluralUnit,
  trialDaysLeft,
  useMarketplaceBilling,
  useMarketplaceModules,
} from "@/lib/api/use-marketplace";
import { pluralDays, useTenantInfo } from "@/lib/api/use-team";
import { useAuth } from "@/lib/auth/use-auth";
import { useCreateCheckout, useBillingPayments } from "@/lib/api/use-billing-checkout";
import { ApiClientError } from "@/lib/api/apiClient";
import { cn } from "@/lib/utils";

/** Человекочитаемое имя плана. */
const PLAN_LABELS: Record<string, string> = {
  trial: "Пробный период",
  starter: "Старт",
  business: "Бизнес",
  enterprise: "Корпоративный",
  partner: "Партнёрский тариф",
  custom_free: "Партнёрский тариф",
};

const STATUS_LABELS: Record<string, string> = {
  trial: "Пробный период",
  active: "Активна",
  past_due: "Ожидает оплаты",
  suspended: "Приостановлена",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

/**
 * Подпись состава позиции.
 *
 * Для базовой CRM показывается расчёт по местам, для канальных модулей — число
 * подключений: без этого строка «500 ₽» не объясняет, откуда сумма.
 */
function itemDetail(
  slug: string,
  quantity: number,
  usersCount: number,
  catalog: { includedUnits: number; unitPrice: number; basePrice: number; unitLabel: string; billingKind: string } | undefined,
): string {
  if (catalog === undefined) return "";

  if (catalog.billingKind === "per_seat") {
    const extra = Math.max(0, usersCount - catalog.includedUnits);
    if (extra === 0) {
      return `${usersCount} польз. — включено ${catalog.includedUnits} в пакет`;
    }
    return `${formatRub(catalog.basePrice)} за ${catalog.includedUnits} польз. + ${extra} × ${formatRub(catalog.unitPrice)}`;
  }

  if (catalog.billingKind === "per_unit") {
    if (catalog.includedUnits > 0) {
      const extra = Math.max(0, quantity - catalog.includedUnits);
      if (extra === 0) {
        return `${quantity} из ${catalog.includedUnits} ${pluralUnit(catalog.includedUnits, catalog.unitLabel)} — включено в базовый тариф (0 ₽)`;
      }
      return `${catalog.includedUnits} в тарифе + ${extra} доп. × ${formatRub(catalog.unitPrice)}`;
    }
    return `${quantity} × ${formatRub(catalog.unitPrice)} за ${catalog.unitLabel}`;
  }

  return "Фиксированная стоимость пакета";
}

function BillingContent() {
  const billing = useMarketplaceBilling();
  const modules = useMarketplaceModules();
  const tenant = useTenantInfo();
  const { user } = useAuth();
  const checkout = useCreateCheckout();
  const paymentsQuery = useBillingPayments();

  const [notice, setNotice] = useState<"card" | "invoice" | null>(null);

  const handleSubscriptionCheckout = useCallback(async () => {
    if (!billing.data) return;
    try {
      const amountToPay =
        billing.data.monthlyTotal > 0
          ? billing.data.monthlyTotal
          : billing.data.monthlyAfterTrials > 0
            ? billing.data.monthlyAfterTrials
            : 1500;

      toast.info("Формируем защищённую ссылку для оплаты Robokassa...");
      const result = await checkout.mutateAsync({
        amount_rubles: amountToPay,
        product_code: "subscription_monthly",
        description: `Оплата подписки GETVOXLY за 1 месяц (${amountToPay} ₽)`,
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
      toast.error("Не удалось сформировать платёж через Robokassa.");
    }
  }, [billing.data, checkout]);

  const catalogBySlug = useMemo(() => {
    const map = new Map<
      string,
      { includedUnits: number; unitPrice: number; basePrice: number; unitLabel: string; billingKind: string }
    >();
    for (const entry of modules.data ?? []) {
      map.set(entry.slug, {
        includedUnits: entry.includedUnits,
        unitPrice: entry.unitPrice,
        basePrice: entry.basePrice,
        unitLabel: entry.unitLabel,
        billingKind: entry.billingKind,
      });
    }
    return map;
  }, [modules.data]);

  if (billing.isLoading || tenant.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (billing.isError || billing.data === undefined) {
    return (
      <div role="alert" className="rounded-[8px] border border-rose-200 bg-rose-50 p-6">
        <p className="text-sm font-semibold text-rose-900">
          Не удалось загрузить данные подписки
        </p>
        <p className="mt-1 text-sm text-rose-700">
          {billing.error?.message ?? "неизвестная ошибка"}
        </p>
        <button
          type="button"
          onClick={() => void billing.refetch()}
          className="mt-3 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa]"
        >
          Повторить
        </button>
      </div>
    );
  }

  const summary = billing.data;
  const info = tenant.data;
  const hasTrials = summary.items.some((item) => item.trialActive);
  const isProviderConnected = Boolean(summary.billingProvider?.connected);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#111111]">Тариф и оплата</h1>
        <p className="mt-1 text-[13px] text-[#666666]">
          Абонентская плата за модули и каналы, отдельно — баланс ИИ
        </p>
      </div>

      {/*
        Два блока разделены намеренно: абонентская плата — фиксированный
        ежемесячный платёж за модули и каналы, баланс ИИ — предоплаченный расход по
        факту вызовов моделей. В одном блоке было непонятно, почему при «к оплате
        1500 ₽» списывают ещё и за токены.
      */}
      <div className="flex items-center gap-2">
        <Receipt className="h-4 w-4 text-[#4a38f5]" />
        <h2 className="text-sm font-semibold text-[#111111]">Абонентская плата</h2>
      </div>

      {/* Текущий тариф и остаток пробного периода */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 shadow-2xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xs uppercase tracking-wider text-[#666666]">Текущий тариф</p>
              {info !== undefined && (
                <StatusBadge
                  variant={
                    info.status === "active"
                      ? "success"
                      : info.status === "trial"
                        ? "info"
                        : info.status === "past_due"
                          ? "warning"
                          : "destructive"
                  }
                  size="sm"
                >
                  {STATUS_LABELS[info.status] ?? info.status}
                </StatusBadge>
              )}
            </div>
            <p className="mt-1.5 text-2xl font-bold text-[#111111]">
              {info?.isPartner || info?.isFreeCustomPlan
                ? (info.customPlanName || "Партнёрский тариф")
                : info?.isCustomPlan
                  ? (info.customPlanName || "Индивидуальный")
                  : summary.isCustomPlan
                    ? (summary.customPlanName || "Индивидуальный")
                    : info === undefined
                      ? "—"
                      : (PLAN_LABELS[info.plan] ?? info.plan)}
            </p>

            {info !== undefined && info.trialActive && !info.isPartner && !info.isFreeCustomPlan && (
              <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                <Gift className="h-4 w-4" />
                Пробный период: осталось {info.trialDaysLeft} {pluralDays(info.trialDaysLeft)}
                {info.trialEndsAt !== null && (
                  <span className="text-[#666666]">· до {formatDate(info.trialEndsAt)}</span>
                )}
              </p>
            )}

            {info !== undefined && !info.trialActive && info.status === "trial" && !info.isPartner && !info.isFreeCustomPlan && (
              <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-amber-700">
                <CalendarClock className="h-4 w-4" />
                Пробный период завершён
              </p>
            )}
          </div>

          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-[#666666]">К оплате в месяц</p>
            <p className="mt-1.5 text-3xl font-bold text-[#111111] tabular-nums font-mono">
              {formatRub(summary.monthlyTotal)}
            </p>
            {hasTrials && summary.monthlyAfterTrials !== summary.monthlyTotal && (
              <p className="mt-1 text-xs text-[#666666]">
                после пробных периодов —{" "}
                <span className="font-semibold text-[#111111] tabular-nums font-mono">
                  {formatRub(summary.monthlyAfterTrials)}/мес
                </span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Детализация счёта */}
      <div className="overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-5 py-3">
          <span className="text-sm font-semibold text-[#111111]">Детализация за месяц</span>
          <span className="flex items-center gap-1.5 text-xs text-[#666666]">
            <Users className="h-3.5 w-3.5" />
            {summary.usersCount} польз.
          </span>
        </div>

        {summary.items.length === 0 ? (
          <EmptyState
            icon={ShoppingBag}
            title="Модули не подключены"
            description="Подключите модули в маркетплейсе — оплата начнётся после пробного периода."
            action={
              <Link
                href="/marketplace"
                className="rounded-[8px] bg-[#4a38f5] px-4 py-2 text-sm font-medium text-white shadow-2xs hover:bg-[#3d2ee0]"
              >
                Открыть маркетплейс
              </Link>
            }
          />
        ) : (
          <>
            <table className="w-full">
              <tbody className="divide-y divide-[#f0f0f0]">
                {summary.items.map((item) => (
                  <tr key={item.slug} className="transition-colors hover:bg-[#fafafa]">
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-[#111111]">{item.name}</span>
                        {item.trialActive && !(catalogBySlug.get(item.slug)?.includedUnits ?? 0) && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            <Gift className="h-3 w-3" />
                            бесплатно ещё {trialDaysLeft(item.trialEndsAt)} дн.
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-[#666666]">
                        {itemDetail(
                          item.slug,
                          item.quantity,
                          summary.usersCount,
                          catalogBySlug.get(item.slug),
                        )}
                      </p>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span
                        className={cn(
                          "text-sm font-semibold tabular-nums font-mono",
                          item.monthlyTotal === 0 ? "text-emerald-700" : "text-[#111111]",
                        )}
                      >
                        {item.monthlyTotal === 0 ? "0 ₽" : `${formatRub(item.monthlyTotal)}`}
                      </span>
                      <span className="text-xs text-[#666666]">/мес</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#e5e5e5] bg-[#fafafa]">
                  <td className="px-5 py-4">
                    <span className="text-sm font-bold uppercase tracking-wide text-[#111111]">
                      Итого к оплате
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <span className="text-lg font-bold text-[#111111] tabular-nums font-mono">
                      {formatRub(summary.monthlyTotal)}
                    </span>
                    <span className="text-xs text-[#666666]">/мес</span>
                  </td>
                </tr>
              </tfoot>
            </table>

            <div className="border-t border-[#e5e5e5] px-5 py-3">
              <p className="text-xs text-[#666666]">
                Число пользователей влияет на стоимость базовой CRM —{" "}
                <Link href="/settings/team" className="text-[#4a38f5] font-medium hover:underline">
                  управление сотрудниками
                </Link>
                . Состав модулей —{" "}
                <Link href="/marketplace" className="text-[#4a38f5] font-medium hover:underline">
                  маркетплейс
                </Link>
                .
              </p>
            </div>
          </>
        )}
      </div>

      {/* Баланс ИИ — второй, отдельный вид платежа */}
      <div className="flex items-center gap-2 border-t border-[#e5e5e5] pt-6">
        <Sparkles className="h-4 w-4 text-[#4a38f5]" />
        <h2 className="text-sm font-semibold text-[#111111]">Баланс ИИ (токены)</h2>
      </div>

      <AiBalanceCard />

      {/* Способы оплаты */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">Способы оплаты</h2>
            <p className="mt-1 text-xs text-[#666666]">
              Оплата подписки картой через Robokassa или по счёту для юридических лиц
            </p>
          </div>
          {isProviderConnected && (
            <span className="inline-flex items-center gap-1 rounded-[4px] border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />
              Robokassa {summary.billingProvider?.testMode ? "(Тестовый режим)" : "подключена"}
            </span>
          )}
        </div>

        {isProviderConnected ? (
          <div className="mt-4 flex gap-3 rounded-[8px] border border-emerald-200 bg-emerald-50/50 p-4">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div className="text-xs leading-relaxed text-emerald-950">
              <p className="font-medium text-emerald-900">Онлайн-эквайринг Robokassa готов к приёму платежей</p>
              <p className="mt-1 text-emerald-800">
                Безопасная оплата картами МИР, Visa, Mastercard, а также через Систему быстрых платежей (СБП). Чек отправляется на ваш email автоматически.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex gap-3 rounded-[8px] border border-sky-200 bg-sky-50 p-4">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
            <div className="text-xs leading-relaxed text-sky-900">
              <p className="font-medium text-sky-800">Платёжный шлюз не настроен</p>
              <p className="mt-1">
                Для активации онлайн-оплаты введите Merchant Login и пароли Robokassa в панели администратора платформы.
              </p>
              {user?.platform_role === "platform_owner" && (
                <Link
                  href="/admin/integrations"
                  className="mt-2 inline-flex items-center gap-1 font-medium text-[#4a38f5] hover:underline"
                >
                  Настроить шлюзы в админке
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              )}
            </div>
          </div>
        )}

        {summary.isFreeCustomPlan ? (
          <div className="mt-4 rounded-[8px] border border-emerald-200 bg-emerald-50/60 p-4 text-xs text-emerald-800">
            <p className="font-semibold text-sm text-emerald-900">Индивидуальный тариф активен</p>
            <p className="mt-1 text-emerald-700">
              Для вашей организации установлен бесплатный индивидуальный тариф ({summary.customPlanName || "Партнёрский"}). Оплата подписки не требуется.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                if (isProviderConnected) {
                  void handleSubscriptionCheckout();
                } else {
                  setNotice("card");
                  toast.info("Подключите Robokassa в панели администратора для приёма карт");
                }
              }}
              disabled={checkout.isPending}
              className="flex items-start gap-3 rounded-[8px] border border-[#e5e5e5] bg-white p-4 text-left shadow-2xs transition-colors hover:border-[#cccccc] hover:bg-[#fafafa] disabled:opacity-50"
            >
              <div className="rounded-[8px] bg-indigo-50 p-2">
                <CreditCard className="h-4 w-4 text-[#4a38f5]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[#111111]">
                  {checkout.isPending ? "Формируем платёж..." : "Оплатить картой онлайн"}
                </p>
                <p className="mt-0.5 text-xs text-[#666666]">
                  {isProviderConnected
                    ? `Оплата за 1 месяц (${formatRub(summary.monthlyTotal > 0 ? summary.monthlyTotal : 1500)})`
                    : "Оплата картой после настройки шлюза"}
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setNotice("invoice");
                toast.info("Запрос отправлен: менеджер свяжется для выставления счёта");
              }}
              className="flex items-start gap-3 rounded-[8px] border border-[#e5e5e5] bg-white p-4 text-left shadow-2xs transition-colors hover:border-[#cccccc] hover:bg-[#fafafa]"
            >
              <div className="rounded-[8px] bg-sky-50 p-2">
                <Building2 className="h-4 w-4 text-sky-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-[#111111]">Счёт для юрлица или ИП</p>
                <p className="mt-0.5 text-xs text-[#666666]">Оплата по счёту с указанием ИНН</p>
              </div>
            </button>
          </div>
        )}

        {notice !== null && (
          <div className="mt-4 flex gap-3 rounded-[8px] border border-amber-200 bg-amber-50 p-4">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="text-xs leading-relaxed text-amber-900">
              {notice === "card" ? (
                <>
                  <p className="font-medium text-[#111111]">Онлайн-оплата картой</p>
                  <p className="mt-1">
                    Шлюз Robokassa ещё не настроен. Администратор платформы может ввести Merchant Login и пароли в разделе «Управление платформой → Шлюзы и ИИ».
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium text-[#111111]">Счёт для юрлица или ИП</p>
                  <p className="mt-1">
                    Напишите на{" "}
                    <a
                      href="mailto:admin@getvoxly.ru"
                      className="text-[#4a38f5] font-medium hover:underline"
                    >
                      admin@getvoxly.ru
                    </a>{" "}
                    название организации и ИНН — счёт на {formatRub(summary.monthlyAfterTrials > 0 ? summary.monthlyAfterTrials : summary.monthlyTotal)}/мес
                    будет выставлен в течение рабочего дня.
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* История онлайн-платежей */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-5 py-3">
          <span className="text-sm font-semibold text-[#111111]">История платежей платформы</span>
          <span className="text-xs text-[#666666]">
            {paymentsQuery.data?.length ?? 0} операций
          </span>
        </div>

        {paymentsQuery.isLoading ? (
          <div className="p-4 space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : !paymentsQuery.data || paymentsQuery.data.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#888888]">
            Платежей пока не было. Все проведённые транзакции отобразятся здесь.
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-[#fbfbfb] text-[#666666] border-b border-[#e5e5e5]">
              <tr>
                <th className="px-5 py-2 font-medium">Счёт #</th>
                <th className="px-5 py-2 font-medium">Назначение</th>
                <th className="px-5 py-2 font-medium">Дата</th>
                <th className="px-5 py-2 font-medium">Статус</th>
                <th className="px-5 py-2 font-medium text-right">Сумма</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f0]">
              {paymentsQuery.data.map((p) => (
                <tr key={p.id} className="h-8 hover:bg-[#fafafa] transition-colors">
                  <td className="px-5 py-2 font-mono text-[#666666]">#{p.robokassa_inv_id}</td>
                  <td className="px-5 py-2 font-medium text-[#111111]">{p.description}</td>
                  <td className="px-5 py-2 text-[#666666]">
                    {formatDate(p.paid_at || p.created_at)}
                  </td>
                  <td className="px-5 py-2">
                    {p.status === "paid" ? (
                      <span className="inline-flex items-center gap-1 rounded-[4px] bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="h-3 w-3" />
                        Оплачен
                      </span>
                    ) : p.status === "pending" ? (
                      <span className="inline-flex items-center gap-1 rounded-[4px] bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 border border-amber-200">
                        <Clock className="h-3 w-3" />
                        Ожидает
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-[4px] bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 border border-rose-200">
                        <XCircle className="h-3 w-3" />
                        Отменён
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-2 text-right font-mono font-semibold text-[#111111]">
                    {formatRub(p.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-[#666666]">
        <Receipt className="h-3.5 w-3.5 text-[#888888]" />
        Счета вашим клиентам выставляются в модуле «Финансы» — этот раздел об оплате подписки на платформу GETVOXLY.
      </p>
    </div>
  );
}

export default function BillingSettingsPage() {
  return (
    <Guard
      requiredPermission="tenant:admin"
      fallback={
        <EmptyState
          icon={CreditCard}
          title="Нет доступа к тарифу и оплате"
          description="Раздел доступен владельцу и администраторам компании."
        />
      }
    >
      <BillingContent />
    </Guard>
  );
}
