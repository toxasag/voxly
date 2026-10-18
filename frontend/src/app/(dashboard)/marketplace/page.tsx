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
        "flex flex-col rounded-[8px] border p-5 shadow-2xs transition-all",
        module.installed
          ? "border-indigo-200 bg-white"
          : "border-[#e5e5e5] bg-white hover:border-[#cccccc]",
      )}
    >
      <div className="mb-3 flex items-start justify-between">
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-[8px]",
            module.installed ? "bg-indigo-50 text-[#4a38f5]" : "bg-[#f5f5f5] text-[#888888]",
          )}
        >
          <Icon className={cn("h-5 w-5", module.installed ? "text-[#4a38f5]" : "text-[#888888]")} />
        </div>

        {/*
          Базовая CRM: переключателя нет вовсе, вместо него статичная плашка.
          Отключить её нельзя — на её контакты и сделки ссылаются остальные
          модули (`repair_orders.customer_id` → `contacts`), поэтому запрет
          держится и в API, и триггером в БД. Заблокированный переключатель
          выглядел бы как поломка, а его отсутствие сразу объясняет правило.
        */}
        {module.isBaseModule ? (
          <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[#4a38f5]">
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
            module.installed ? "text-[#4a38f5]" : "text-[#888888] hover:text-[#666666]",
          )}
        >
          {toggle.isPending ? (
            <Loader2 className="h-6 w-6 animate-spin text-[#4a38f5]" />
          ) : module.installed ? (
            <ToggleRight className="h-6 w-6" />
          ) : (
            <ToggleLeft className="h-6 w-6" />
          )}
        </button>
        )}
      </div>

      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-[#111111]">{module.name}</h3>

        {/* Бейдж пробного периода. Для подключённого модуля показываем остаток,
            иначе пользователь не знает, сколько ещё бесплатно. */}
        {module.trialActive ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
            <Gift className="h-3 w-3" />
            Бесплатно ещё {daysLeft} дн.
          </span>
        ) : (
          !module.installed && (
            <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
              <Gift className="h-3 w-3" />
              {module.trialDays} дней бесплатно
            </span>
          )
        )}
      </div>

      <p className="mb-3 text-xs leading-relaxed text-[#666666]">{module.description}</p>

      <div className="mb-3">
        <p className="text-sm font-bold text-[#111111] tabular-nums font-mono">{priceCaption(module)}</p>
        {module.isMulti && (
          <p className="mt-0.5 text-xs text-[#666666]">
            {quantity} × {formatRub(module.unitPrice)} ={" "}
            <span className="font-semibold text-[#111111] tabular-nums font-mono">
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
            className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#e5e5e5] bg-white text-[#666666] shadow-2xs transition-colors hover:border-[#cccccc] hover:text-[#111111] disabled:opacity-40"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>

          <span className="min-w-[92px] text-center text-xs font-medium text-[#111111] tabular-nums">
            {quantity} {pluralUnit(quantity, module.unitLabel)}
          </span>

          <button
            type="button"
            onClick={() => void changeQuantity(quantity + 1)}
            disabled={isBusy || quantity >= 100}
            aria-label="Увеличить количество"
            className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#e5e5e5] bg-white text-[#666666] shadow-2xs transition-colors hover:border-[#cccccc] hover:text-[#111111] disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>

          {updateQuantity.isPending && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#888888]" />
          )}
        </div>
      )}

      <div className="mt-auto space-y-1">
        {module.features.map((feature) => (
          <div key={feature} className="flex items-center gap-1.5">
            <Check className="h-3 w-3 shrink-0 text-emerald-600" />
            <span className="text-xs text-[#666666]">{feature}</span>
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
          className="mt-4 flex items-center justify-center gap-2 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-xs font-medium text-[#111111] shadow-2xs transition-colors hover:bg-[#fafafa]"
        >
          <Users className="h-3.5 w-3.5 text-[#666666]" />
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

  if (isLoading) return <Skeleton className="h-20 w-full rounded-[8px]" />;
  if (data === undefined || data.items.length === 0) return null;

  const hasTrials = data.items.some((item) => item.trialActive);

  return (
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-[#666666]">
            К оплате в месяц
          </p>
          <p className="mt-1 text-2xl font-bold text-[#111111] tabular-nums font-mono">
            {formatRub(data.monthlyTotal)}
          </p>
          {/* Показываем сумму после пробных периодов: иначе счёт вырос бы
              неожиданно, когда они закончатся. */}
          {hasTrials && data.monthlyAfterTrials !== data.monthlyTotal && (
            <p className="mt-1 text-xs text-[#666666]">
              после окончания пробных периодов —{" "}
              <span className="font-semibold text-[#111111] tabular-nums font-mono">
                {formatRub(data.monthlyAfterTrials)}/мес
              </span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="text-right">
            <p className="text-xs text-[#666666]">Пользователей в портале</p>
            <Link
              href="/settings/team"
              className="text-sm font-semibold text-[#111111] tabular-nums underline-offset-2 hover:text-[#4a38f5] hover:underline"
            >
              {data.usersCount}
            </Link>
          </div>

          <Link
            href="/settings/billing"
            className="flex items-center gap-2 rounded-[8px] bg-[#4a38f5] px-4 py-2.5 text-sm font-medium text-white shadow-2xs transition-colors hover:bg-[#3d2ee0]"
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
          <h1 className="text-xl font-bold text-[#111111]">Маркетплейс модулей</h1>
          <p className="mt-1 text-[13px] text-[#666666]">
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
                "rounded-[8px] border px-3 py-1.5 text-xs font-medium transition-colors shadow-2xs",
                category === cat
                  ? "border-[#4a38f5] bg-indigo-50 text-[#4a38f5]"
                  : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111] hover:bg-[#fafafa]",
              )}
            >
              {cat === "all" ? "Все" : CATEGORY_LABELS[cat] ?? cat}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-64 w-full rounded-[8px]" />
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-[8px] border border-rose-200 bg-rose-50 p-6">
            <p className="text-sm font-semibold text-rose-900">
              Не удалось загрузить каталог
            </p>
            <p className="mt-1 text-sm text-rose-700">
              {error?.message}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-3 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa]"
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
