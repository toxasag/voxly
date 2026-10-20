import { z } from "zod";

import { BASE_MODULE_SLUG, MODULE_SLUGS } from "../../types/index.js";

/**
 * Слаги каталога: базовый модуль плюс все модули с разделами интерфейса.
 *
 * Собирается из `MODULE_SLUGS`, а не перечисляется заново: до этого список
 * существовал здесь и в `ModuleSlug` независимо, и каналы попали только в один
 * из них — маркетплейс их продавал, а `requireModule` о них не знал.
 *
 * `ai_bots` сознательно не переименован в `ai_agents`, хотя отображается как
 * «AI-агенты»: слаг уже используется типом ModuleSlug, гейтом `requireModule`,
 * компонентом `<Guard>` и строками `installed_modules` у существующих
 * арендаторов. Переименование потребовало бы миграции данных ради косметики.
 */
export const moduleSlugSchema = z.enum([BASE_MODULE_SLUG, ...MODULE_SLUGS]);
export type MarketplaceSlug = z.infer<typeof moduleSlugSchema>;

/** Модель тарификации модуля. */
export type BillingKind = "flat" | "per_seat" | "per_unit";

/**
 * Переключение модуля.
 *
 * `quantity` относится только к `per_unit`: число агентов или аккаунтов канала.
 * Верхняя граница нужна, чтобы опечатка в интерфейсе не превратилась в счёт на
 * сотни тысяч рублей.
 */
export const toggleModuleSchema = z.object({
  enabled: z.boolean(),
  quantity: z.number().int().min(1).max(100).optional(),
});

/** Изменение количества у уже подключённого модуля. */
export const updateQuantitySchema = z.object({
  quantity: z.number().int().min(1).max(100),
});

export interface MarketplaceModuleDTO {
  slug: string;
  name: string;
  description: string;
  /** Витринная цена «от» — для сортировки и обратной совместимости. */
  priceMonthly: number;
  billingKind: BillingKind;
  basePrice: number;
  unitPrice: number;
  includedUnits: number;
  unitLabel: string;
  isMulti: boolean;
  /**
   * Базовый модуль, который нельзя отключить.
   *
   * Признак приходит с сервера, а не выводится клиентом из слага: правило
   * относится к модели данных (на контакты и сделки `core_crm` ссылаются
   * остальные модули), и его дублирование в интерфейсе строкой-константой
   * разошлось бы с бэкендом при первом изменении состава.
   */
  isBaseModule: boolean;
  category: string;
  icon: string;
  trialDays: number;
  features: string[];
  installed: boolean;
  installedAt: string | null;
  /** Число подключённых единиц; 0 если модуль не установлен. */
  quantity: number;
  /** Окончание пробного периода в ISO, если он активен. */
  trialEndsAt: string | null;
  /** Пробный период ещё действует: считается на сервере, а не в браузере. */
  trialActive: boolean;
  /**
   * Фактическая сумма к оплате в месяц с учётом количества и мест.
   * Для активного пробного периода — 0.
   */
  monthlyTotal: number;
}

/** Сводка по подписке арендатора. */
export interface BillingSummaryDTO {
  /** Сумма по всем подключённым модулям без пробных. */
  monthlyTotal: number;
  /** Сколько было бы к оплате, если бы пробные периоды закончились. */
  monthlyAfterTrials: number;
  usersCount: number;
  items: {
    slug: string;
    name: string;
    quantity: number;
    monthlyTotal: number;
    trialActive: boolean;
    trialEndsAt: string | null;
  }[];
  billingProvider?: {
    connected: boolean;
    provider: string | null;
  };
}
