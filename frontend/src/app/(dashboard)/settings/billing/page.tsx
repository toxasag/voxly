"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertCircle,
  Building2,
  CalendarClock,
  CreditCard,
  Gift,
  Info,
  Receipt,
  ShoppingBag,
  Sparkles,
  Users,
} from "lucide-react";
import { AiBalanceCard } from "@/components/settings/AiBalanceCard";
import { Guard } from "@/components/shared/Guard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  formatRub,
  trialDaysLeft,
  useMarketplaceBilling,
  useMarketplaceModules,
} from "@/lib/api/use-marketplace";
import { pluralDays, useTenantInfo } from "@/lib/api/use-team";
import { cn } from "@/lib/utils";

/** Человекочитаемое имя плана. */
const PLAN_LABELS: Record<string, string> = {
  trial: "Пробный период",
  starter: "Старт",
  business: "Бизнес",
  enterprise: "Корпоративный",
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
    return `${quantity} × ${formatRub(catalog.unitPrice)} за ${catalog.unitLabel}`;
  }

  return "Фиксированная стоимость пакета";
}

function BillingContent() {
  const billing = useMarketplaceBilling();
  const modules = useMarketplaceModules();
  const tenant = useTenantInfo();

  // Оба диалога оплаты пока информационные: платёжный провайдер не подключён,
  // и кнопка, ведущая в никуда, была бы хуже честной подписи.
  const [notice, setNotice] = useState<"card" | "invoice" | null>(null);

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
      <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6">
        <p className="text-sm text-rose-400">
          Не удалось загрузить данные подписки: {billing.error?.message ?? "неизвестная ошибка"}
        </p>
        <button
          type="button"
          onClick={() => void billing.refetch()}
          className="mt-3 rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
        >
          Повторить
        </button>
      </div>
    );
  }

  const summary = billing.data;
  const info = tenant.data;
  const hasTrials = summary.items.some((item) => item.trialActive);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Тариф и оплата</h1>
        <p className="mt-1 text-sm text-slate-400">
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
        <Receipt className="h-4 w-4 text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-200">Абонентская плата</h2>
      </div>

      {/* Текущий тариф и остаток пробного периода */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xs uppercase tracking-wider text-slate-500">Текущий тариф</p>
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
            <p className="mt-1.5 text-2xl font-bold text-slate-100">
              {info === undefined ? "—" : (PLAN_LABELS[info.plan] ?? info.plan)}
            </p>

            {info !== undefined && info.trialActive && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-400">
                <Gift className="h-4 w-4" />
                Пробный период: осталось {info.trialDaysLeft} {pluralDays(info.trialDaysLeft)}
                {info.trialEndsAt !== null && (
                  <span className="text-slate-500">· до {formatDate(info.trialEndsAt)}</span>
                )}
              </p>
            )}

            {info !== undefined && !info.trialActive && info.status === "trial" && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-amber-400">
                <CalendarClock className="h-4 w-4" />
                Пробный период завершён
              </p>
            )}
          </div>

          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-slate-500">К оплате в месяц</p>
            <p className="mt-1.5 text-3xl font-bold text-slate-100">
              {formatRub(summary.monthlyTotal)}
            </p>
            {hasTrials && summary.monthlyAfterTrials !== summary.monthlyTotal && (
              <p className="mt-1 text-xs text-slate-500">
                после пробных периодов —{" "}
                <span className="font-medium text-slate-300">
                  {formatRub(summary.monthlyAfterTrials)}/мес
                </span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Детализация счёта */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <span className="text-sm font-semibold text-slate-200">Детализация за месяц</span>
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
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
                className="rounded-lg bg-[#4a38f5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3b2be0]"
              >
                Открыть маркетплейс
              </Link>
            }
          />
        ) : (
          <>
            <table className="w-full">
              <tbody className="divide-y divide-slate-800">
                {summary.items.map((item) => (
                  <tr key={item.slug} className="transition-colors hover:bg-slate-800/50">
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-200">{item.name}</span>
                        {item.trialActive && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                            <Gift className="h-3 w-3" />
                            бесплатно ещё {trialDaysLeft(item.trialEndsAt)} дн.
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
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
                          "text-sm font-semibold",
                          item.monthlyTotal === 0 ? "text-emerald-400" : "text-slate-100",
                        )}
                      >
                        {item.monthlyTotal === 0 ? "0 ₽" : `${formatRub(item.monthlyTotal)}`}
                      </span>
                      <span className="text-xs text-slate-500">/мес</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-700 bg-slate-950/50">
                  <td className="px-5 py-4">
                    <span className="text-sm font-bold uppercase tracking-wide text-slate-200">
                      Итого к оплате
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <span className="text-lg font-bold text-amber-400">
                      {formatRub(summary.monthlyTotal)}
                    </span>
                    <span className="text-xs text-slate-500">/мес</span>
                  </td>
                </tr>
              </tfoot>
            </table>

            <div className="border-t border-slate-800 px-5 py-3">
              <p className="text-xs text-slate-500">
                Число пользователей влияет на стоимость базовой CRM —{" "}
                <Link href="/settings/team" className="text-[#4a38f5] hover:text-[#4a38f5]">
                  управление сотрудниками
                </Link>
                . Состав модулей —{" "}
                <Link href="/marketplace" className="text-[#4a38f5] hover:text-[#4a38f5]">
                  маркетплейс
                </Link>
                .
              </p>
            </div>
          </>
        )}
      </div>

      {/* Баланс ИИ — второй, отдельный вид платежа */}
      <div className="flex items-center gap-2 border-t border-slate-800 pt-6">
        <Sparkles className="h-4 w-4 text-amber-400" />
        <h2 className="text-sm font-semibold text-slate-200">Баланс ИИ (токены)</h2>
      </div>

      <AiBalanceCard />

      {/* Способы оплаты */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-sm font-semibold text-slate-200">Способы оплаты</h2>
        <p className="mt-1 text-xs text-slate-500">
          Выберите, как оплачивать подписку после пробного периода
        </p>

        {/*
          Платёжный провайдер не подключён (backend отдаёт
          billingProvider.connected = false). Пишем это прямо, а не имитируем
          работающую оплату: пользователь должен понимать, что списание пока
          невозможно, и как поступить.
        */}
        <div className="mt-4 flex gap-3 rounded-lg border border-sky-500/30 bg-sky-500/5 p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
          <div className="text-xs leading-relaxed text-slate-400">
            <p className="font-medium text-sky-400">Автоматическое списание пока недоступно</p>
            <p className="mt-1">
              Платёжный провайдер в процессе подключения. Оставьте заявку — менеджер выставит счёт
              и активирует подписку вручную. Доступ к данным при этом не ограничивается.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              setNotice("card");
              toast.info("Привязка карты станет доступна после подключения платёжного провайдера");
            }}
            className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-950 p-4 text-left transition-colors hover:border-slate-600"
          >
            <div className="rounded-lg bg-[#4a38f5]/10 p-2">
              <CreditCard className="h-4 w-4 text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">Привязать карту</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Автопродление подписки каждый месяц
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setNotice("invoice");
              toast.info("Запрос отправлен: менеджер свяжется для выставления счёта");
            }}
            className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-950 p-4 text-left transition-colors hover:border-slate-600"
          >
            <div className="rounded-lg bg-sky-500/10 p-2">
              <Building2 className="h-4 w-4 text-sky-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">Счёт для юрлица или ИП</p>
              <p className="mt-0.5 text-xs text-slate-500">Оплата по счёту с указанием ИНН</p>
            </div>
          </button>
        </div>

        {notice !== null && (
          <div className="mt-4 flex gap-3 rounded-lg border border-slate-700 bg-slate-950 p-4">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div className="text-xs leading-relaxed text-slate-400">
              {notice === "card" ? (
                <>
                  <p className="font-medium text-slate-200">Привязка карты</p>
                  <p className="mt-1">
                    Как только эквайринг будет подключён, здесь появится форма привязки карты и
                    автопродление. Пока подписка активируется вручную.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium text-slate-200">Счёт для юрлица или ИП</p>
                  <p className="mt-1">
                    Напишите на{" "}
                    <a
                      href="mailto:admin@getvoxly.ru"
                      className="text-[#4a38f5] hover:text-[#4a38f5]"
                    >
                      admin@getvoxly.ru
                    </a>{" "}
                    название организации и ИНН — счёт на {formatRub(summary.monthlyAfterTrials)}/мес
                    будет выставлен в течение рабочего дня.
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <Receipt className="h-3.5 w-3.5" />
        Счёта вашим клиентам выставляются в модуле «Финансы» — этот раздел о подписке на платформу.
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
