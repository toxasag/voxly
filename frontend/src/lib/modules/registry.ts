import {
  Bot,
  Hash,
  Instagram,
  MessageCircle,
  MessageSquareText,
  Receipt,
  Send,
  Store,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import type { ChannelSlug, ModuleSlug, Permission } from "@/types";
import { CHANNEL_SLUGS } from "@/types";

// ---------------------------------------------------------------------------
// Реестр модулей: слаг маркетплейса → раздел интерфейса.
//
// До него связь «модуль ↔ пункт меню» существовала только внутри `Sidebar.tsx`, и
// каналы в неё не попали: маркетплейс их продавал, а меню о них не знало —
// подключить канал было можно, работать с ним негде.
//
// Реестр держит в одном месте маршрут, иконку, название и требуемое право,
// поэтому новый модуль добавляется одной записью, а не правкой сайдбара, страницы
// и гейта по отдельности.
// ---------------------------------------------------------------------------

export interface ModuleRegistryEntry {
  slug: ModuleSlug;
  /** Подпись в сайдбаре и в шапке раздела. */
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * Право, без которого пункт не показывается.
   *
   * У каналов это `tenant:admin`: подключение аккаунта — тарифное и техническое
   * действие (токены ботов), а не рядовая работа с клиентами. Отдельные
   * `channels:read/write` дублировали бы `tenant:admin` без разницы в поведении,
   * поэтому в `Permission` они не вводились.
   */
  permission: Permission;
}

/** Каналы связи: маршрут `/integrations/<slug>`, иконка совпадает с карточкой маркетплейса. */
const CHANNEL_REGISTRY: Record<ChannelSlug, ModuleRegistryEntry> = {
  telegram: {
    slug: "telegram",
    label: "Telegram",
    href: "/integrations/telegram",
    icon: Send,
    permission: "tenant:admin",
  },
  whatsapp: {
    slug: "whatsapp",
    label: "WhatsApp",
    href: "/integrations/whatsapp",
    icon: MessageCircle,
    permission: "tenant:admin",
  },
  max: {
    slug: "max",
    label: "MAX",
    href: "/integrations/max",
    icon: Hash,
    permission: "tenant:admin",
  },
  avito: {
    slug: "avito",
    label: "Avito",
    href: "/integrations/avito",
    icon: Store,
    permission: "tenant:admin",
  },
  instagram: {
    slug: "instagram",
    label: "Instagram",
    href: "/integrations/instagram",
    icon: Instagram,
    permission: "tenant:admin",
  },
  webchat: {
    slug: "webchat",
    label: "Онлайн-чат",
    href: "/integrations/webchat",
    icon: MessageSquareText,
    permission: "tenant:admin",
  },
  telegram_bot: {
    slug: "telegram_bot",
    label: "Telegram-бот",
    href: "/integrations/telegram_bot",
    icon: Bot,
    permission: "tenant:admin",
  },
  max_bot: {
    slug: "max_bot",
    label: "MAX-бот",
    href: "/integrations/max_bot",
    icon: Hash,
    permission: "tenant:admin",
  },
};

/**
 * Модули с разделами интерфейса.
 *
 * `core_crm` отсутствует намеренно: его разделы (панель, аналитика, сделки,
 * контакты, компании, задачи) видны всегда — это базовый тариф, который нельзя
 * отключить, и гейт по установке для них не имеет смысла.
 */
export const MODULE_REGISTRY: Record<ModuleSlug, ModuleRegistryEntry> = {
  service_center: {
    slug: "service_center",
    label: "Сервисный центр",
    // `/repairs`, а не `/modules/service-center`: маршрут существует с M3 и на
    // него ссылаются ссылки в CRM. Перенос ради симметрии с AGENTS.md сломал бы
    // их без выгоды.
    href: "/repairs",
    icon: Wrench,
    permission: "service_center:read",
  },
  finance: {
    slug: "finance",
    label: "Финансы",
    href: "/finance",
    icon: Receipt,
    permission: "finance:read",
  },
  ai_bots: {
    slug: "ai_bots",
    label: "AI-боты",
    href: "/modules/ai-bots",
    icon: Bot,
    permission: "ai_bots:read",
  },
  ...CHANNEL_REGISTRY,
};

/** Каналы в порядке каталога маркетплейса (`sort_order`). */
export const CHANNEL_ENTRIES: readonly ModuleRegistryEntry[] = CHANNEL_SLUGS.map(
  (slug) => CHANNEL_REGISTRY[slug],
);

/** Разделы модулей ядра — идут в сайдбаре до блока каналов. */
export const CORE_MODULE_ENTRIES: readonly ModuleRegistryEntry[] = [
  MODULE_REGISTRY.service_center,
  MODULE_REGISTRY.finance,
  MODULE_REGISTRY.ai_bots,
];

export function channelEntry(slug: ChannelSlug): ModuleRegistryEntry {
  return CHANNEL_REGISTRY[slug];
}
