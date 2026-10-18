"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Bot,
  Check,
  CreditCard,
  Gift,
  Hash,
  Instagram,
  Loader2,
  Lock,
  MessageCircle,
  MessageSquareText,
  Minus,
  Plus,
  Puzzle,
  Receipt,
  Send,
  ShoppingBag,
  Store,
  ToggleLeft,
  ToggleRight,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Guard } from "@/components/shared/Guard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { DisableModuleDialog } from "@/components/marketplace/DisableModuleDialog";
import {
  formatRub,
  trialDaysLeft,
  useMarketplaceBilling,
  useMarketplaceModules,
  useToggleModule,
  useUpdateModuleQuantity,
  type MarketplaceModuleDTO,
} from "@/lib/api/use-marketplace";
import { cn } from "@/lib/utils";

/**
 * Иконки приходят из каталога по имени, а не задаются в коде по слагу: новый
 * канал появляется одной строкой в БД и не требует правки фронтенда.
 */
const ICONS: Record<string, LucideIcon> = {
  Users,
  Wrench,
  Receipt,
  Bot,
  Send,
  MessageCircle,
  MessageSquareText,
  Hash,
  Store,
  Instagram,
  Puzzle,
};

const CATEGORY_LABELS: Record<string, string> = {
  crm: "Ядро CRM",
  service: "Сервис",
  finance: "Финансы",
  ai: "AI и автоматизация",
  integration: "Интеграции",
};

/** Подпись тарифа: модель расчёта различается, одной строкой не описать. */
function priceCaption(module: MarketplaceModuleDTO): string {
  switch (module.billingKind) {
    case "per_seat":
      return `${formatRub(module.basePrice)}/мес за ${module.includedUnits} пользователей, далее +${formatRub(module.unitPrice)} за каждого`;
    case "per_unit":
      if (module.includedUnits > 0) {
        return `${module.includedUnits} ${pluralUnit(module.includedUnits, module.unitLabel)} в базе бесплатно, далее +${formatRub(module.unitPrice)}/мес за каждый`;
      }
      return `${formatRub(module.unitPrice)}/мес за 1 ${module.unitLabel}`;
    case "flat":
      return `${formatRub(module.basePrice)}/мес`;
  }
}

/** Склонение подписи единицы: 1 агент, 2 агента, 5 агентов. */
function pluralUnit(count: number, label: string): string {
  if (label === "агент") {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return "агент";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "агента";
    return "агентов";
  }
  if (label === "аккаунт") {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return "аккаунт";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "аккаунта";
    return "аккаунтов";
  }
  if (label === "сайт") {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return "сайт";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "сайта";
    return "сайтов";
  }
  if (label === "бот") {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return "бот";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "бота";
    return "ботов";
  }
  return label;
}

function ModuleCard({ module }: { module: MarketplaceModuleDTO }) {
  const toggle = useToggleModule();
  const updateQuantity = useUpdateModuleQuantity();

  // Локальный счётчик до подключения: пока модуль не установлен, количество
  // ещё не хранится на сервере.
  const [draftQuantity, setDraftQuantity] = useState(1);
  const [disableOpen, setDisableOpen] = useState(false);

  const Icon = ICONS[module.icon] ?? Puzzle;
  const isBusy = toggle.isPending || updateQuantity.isPending;
  const quantity = module.installed ? module.quantity : draftQuantity;
  const daysLeft = trialDaysLeft(module.trialEndsAt);

  /**
   * Подключение и отключение.
   *
   * Отключение проходит только после подтверждения в диалоге: оно скрывает
   * данные модуля, и один неверный клик по переключателю не должен этого делать.
   */
  const applyToggle = useCallback(
    async (enabled: boolean) => {
      try {
        const result = await toggle.mutateAsync({
          slug: module.slug,
          enabled,
          ...(module.isMulti && enabled && { quantity: draftQuantity }),
        });

        if (enabled) {
          const restored =
            result.affectedRows > 0 ? ` Данные восстановлены: ${result.affectedRows}.` : "";

          toast.success(
            result.trialEndsAt !== null
              ? `${module.name} подключён — 14 дней бесплатно.${restored}`
              : `${module.name} подключён.${restored}`,
          );
        } else {
          toast.success(
            result.affectedRows > 0
              ? `${module.name} отключён. Скрыто записей: ${result.affectedRows}, хранятся ${result.graceDays ?? 30} дн.`
              : `${module.name} отключён`,
          );
        }

        setDisableOpen(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось изменить подключение");
      }
    },
    [toggle, module, draftQuantity],
  );

  const handleToggle = useCallback(() => {
    // Базовая CRM не отключается — у неё нет переключателя, но проверка
    // остаётся: состав модулей меняется и кодом.
    if (module.isBaseModule) return;

    if (module.installed) {
      setDisableOpen(true);
      return;
    }

    void applyToggle(true);
  }, [module.isBaseModule, module.installed, applyToggle]);

  const changeQuantity = useCallback(
    async (next: number) => {
      if (next < 1 || next > 100) return;

      if (!module.installed) {
        setDraftQuantity(next);
        return;
      }

      try {
        await updateQuantity.mutateAsync({ slug: module.slug, quantity: next });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось изменить количество");
      }
    },
    [module.installed, module.slug, updateQuantity],
  );

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border p-5 transition-all",
        module.installed
          ? "border-[#4a38f5]/40 bg-slate-900"
          : "border-slate-800 bg-slate-900 hover:border-slate-700",
      )}
    >
      <div className="mb-3 flex items-start justify-between">
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-xl",
            module.installed ? "bg-[#4a38f5]/10" : "bg-slate-800",
          )}
        >
          <Icon className={cn("h-5 w-5", module.installed ? "text-amber-400" : "text-slate-500")} />
        </div>

        {/*
          Базовая CRM: переключателя нет вовсе, вместо него статичная плашка.
          Отключить её нельзя — на её контакты и сделки ссылаются остальные
          модули (`repair_orders.customer_id` → `contacts`), поэтому запрет
          держится и в API, и триггером в БД. Заблокированный переключатель
          выглядел бы как поломка, а его отсутствие сразу объясняет правило.
        */}
        {module.isBaseModule ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#4a38f5]/30 bg-[#4a38f5]/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-amber-400">
            <Lock className="h-3 w-3" />
            Базовый тариф
          </span>
        ) : (
        <button
          type="button"
          onClick={handleToggle}
          disabled={isBusy}
          aria-label={module.installed ? `Отключить ${module.name}` : `Подключить ${module.name}`}
          className={cn(
            "transition-colors disabled:opacity-50",
            module.installed ? "text-amber-400" : "text-slate-600 hover:text-slate-400",
          )}
        >
          {toggle.isPending ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : module.installed ? (
            <ToggleRight className="h-6 w-6" />
          ) : (
            <ToggleLeft className="h-6 w-6" />
          )}
        </button>
        )}
      </div>

      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-100">{module.name}</h3>

        {/* Бейдж пробного периода. Для подключённого модуля показываем остаток,
            иначе пользователь не знает, сколько ещё бесплатно. */}
        {module.trialActive ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
            <Gift className="h-3 w-3" />
            Бесплатно ещё {daysLeft} дн.
          </span>
        ) : (
          !module.installed && (
            <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-400">
              <Gift className="h-3 w-3" />
              {module.trialDays} дней бесплатно
            </span>
          )
        )}
      </div>

      <p className="mb-3 text-xs leading-relaxed text-slate-500">{module.description}</p>

      <div className="mb-3">
        <p className="text-sm font-bold text-slate-100">{priceCaption(module)}</p>
        {module.isMulti && (
          <p className="mt-0.5 text-xs text-slate-500">
            {quantity} × {formatRub(module.unitPrice)} ={" "}
            <span className="font-semibold text-slate-300">
              {formatRub(module.unitPrice * quantity)}/мес
            </span>
          </p>
        )}
      </div>

      {/* Счётчик подключений — только для модулей с количественным учётом. */}
      {module.isMulti && (
        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void changeQuantity(quantity - 1)}
            disabled={isBusy || quantity <= 1}
            aria-label="Уменьшить количество"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200 disabled:opacity-40"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>

          <span className="min-w-[92px] text-center text-xs text-slate-300">
            {quantity} {pluralUnit(quantity, module.unitLabel)}
          </span>

          <button
            type="button"
            onClick={() => void changeQuantity(quantity + 1)}
            disabled={isBusy || quantity >= 100}
            aria-label="Увеличить количество"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>

          {updateQuantity.isPending && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
          )}
        </div>
      )}

      <div className="mt-auto space-y-1">
        {module.features.map((feature) => (
          <div key={feature} className="flex items-center gap-1.5">
            <Check className="h-3 w-3 shrink-0 text-emerald-500" />
            <span className="text-xs text-slate-400">{feature}</span>
          </div>
        ))}
      </div>

      {/*
        Тариф базовой CRM считается по числу пользователей, поэтому с её карточки
        ведём прямо в управление сотрудниками: именно там меняется величина,
        определяющая стоимость этой строки счёта.
      */}
      {module.billingKind === "per_seat" && (
        <Link
          href="/settings/team"
          className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800"
        >
          <Users className="h-3.5 w-3.5" />
          Управление пользователями
        </Link>
      )}

      <DisableModuleDialog
        open={disableOpen}
        moduleName={module.name}
        moduleSlug={module.slug}
        onClose={() => setDisableOpen(false)}
        onConfirm={() => applyToggle(false)}
        isPending={toggle.isPending}
      />
    </div>
  );
}

function BillingBar() {
  const { data, isLoading } = useMarketplaceBilling();

  if (isLoading) return <Skeleton className="h-20 w-full" />;
  if (data === undefined || data.items.length === 0) return null;

  const hasTrials = data.items.some((item) => item.trialActive);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500">
            К оплате в месяц
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-100">
            {formatRub(data.monthlyTotal)}
          </p>
          {/* Показываем сумму после пробных периодов: иначе счёт вырос бы
              неожиданно, когда они закончатся. */}
          {hasTrials && data.monthlyAfterTrials !== data.monthlyTotal && (
            <p className="mt-1 text-xs text-slate-500">
              после окончания пробных периодов —{" "}
              <span className="font-medium text-slate-300">
                {formatRub(data.monthlyAfterTrials)}/мес
              </span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="text-right">
            <p className="text-xs text-slate-500">Пользователей в портале</p>
            <Link
              href="/settings/team"
              className="text-sm font-semibold text-slate-200 underline-offset-2 hover:text-[#4a38f5] hover:underline"
            >
              {data.usersCount}
            </Link>
          </div>

          <Link
            href="/settings/billing"
            className="flex items-center gap-2 rounded-lg bg-[#4a38f5] px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#3b2be0]"
          >
            <CreditCard className="h-4 w-4" />
            Оплатить и управлять подпиской
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function MarketplacePage() {
  const { data, isLoading, isError, error, refetch } = useMarketplaceModules();
  const [category, setCategory] = useState<string>("all");

  const categories = useMemo(() => {
    if (data === undefined) return ["all"];
    return ["all", ...Array.from(new Set(data.map((m) => m.category)))];
  }, [data]);

  const filtered = useMemo(() => {
    if (data === undefined) return [];
    return category === "all" ? data : data.filter((m) => m.category === category);
  }, [data, category]);

  return (
    <Guard requiredPermission="tenant:admin">
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Маркетплейс модулей</h1>
          <p className="mt-1 text-sm text-slate-400">
            Подключайте модули и каналы. Каждый новый модуль — 14 дней бесплатно.
          </p>
        </div>

        <BillingBar />

        <div className="flex flex-wrap items-center gap-1.5">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                category === cat
                  ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                  : "border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300",
              )}
            >
              {cat === "all" ? "Все" : CATEGORY_LABELS[cat] ?? cat}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-64 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6">
            <p className="text-sm text-rose-400">
              Не удалось загрузить каталог: {error?.message}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-3 rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
            >
              Повторить
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ShoppingBag}
            title="Модулей в этой категории нет"
            description="Выберите другую категорию."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((module) => (
              <ModuleCard key={module.slug} module={module} />
            ))}
          </div>
        )}
      </div>
    </Guard>
  );
}
