import {
  LayoutDashboard,
  Handshake,
  Users,
  Building2,
  ListChecks,
  BarChart3,
  ShoppingBag,
  CreditCard,
  Activity,
  ScrollText,
  Settings,
  UserCircle,
  type LucideIcon,
} from "lucide-react";

import { CHANNEL_ENTRIES, CORE_MODULE_ENTRIES } from "@/lib/modules/registry";
import type { ModuleSlug, Permission } from "@/types";

// ---------------------------------------------------------------------------
// Навигационные списки портала и правило видимости разделов.
//
// Вынесено из `Sidebar.tsx` (556 строк) как предварительное условие мобильного
// меню: маршрут `/menu` показывает те же разделы, и без общего модуля в нём
// возникла бы вторая копия правил. Расхождение было бы вопросом времени, а не
// вероятности — скрытый в сайдбаре раздел остался бы видимым в мобильном меню, и
// пользователь получал бы заглушку «нет доступа» по ссылке из меню.
//
// Здесь только данные и чистая функция видимости: ни хуков, ни разметки. Поэтому
// модуль тестируется без рендера и без моков, а оба потребителя — сайдбар и
// страница меню — остаются тонкими.
// ---------------------------------------------------------------------------

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Пункт базового тарифа: виден всегда, гейт по установке не применяется. */
  always: boolean;
  moduleSlug?: ModuleSlug;
  /** Право, без которого пункт скрыт. У разделов базовой CRM отсутствует. */
  permission?: Permission;
}

export const CORE_NAV: NavItem[] = [
  { label: "Панель", href: "/dashboard", icon: LayoutDashboard, always: true },
  { label: "Аналитика", href: "/analytics", icon: BarChart3, always: true },
  { label: "Сделки", href: "/crm/deals", icon: Handshake, always: true },
  { label: "Контакты", href: "/crm/contacts", icon: Users, always: true },
  { label: "Компании", href: "/crm/companies", icon: Building2, always: true },
  { label: "Задачи", href: "/crm/tasks", icon: ListChecks, always: true },
];

/**
 * Разделы модулей и каналов собираются из общего реестра, а не перечисляются
 * здесь: до этого связь «модуль ↔ пункт меню» жила только в сайдбаре, и пять
 * каналов в неё не попали — маркетплейс их продавал, а меню о них не знало.
 */
export const MODULE_NAV: NavItem[] = CORE_MODULE_ENTRIES.map((entry) => ({
  label: entry.label,
  href: entry.href,
  icon: entry.icon,
  always: false,
  moduleSlug: entry.slug,
  permission: entry.permission,
}));

/** Каналы связи — отдельный блок сайдбара, как «Управление платформой». */
export const CHANNEL_NAV: NavItem[] = CHANNEL_ENTRIES.map((entry) => ({
  label: entry.label,
  href: entry.href,
  icon: entry.icon,
  always: false,
  moduleSlug: entry.slug,
  permission: entry.permission,
}));

/** Маркетплейс входит в базовый тариф: без него отключённый модуль не вернуть. */
export const MARKETPLACE_NAV: NavItem = {
  label: "Маркетплейс модулей",
  href: "/marketplace",
  icon: ShoppingBag,
  always: true,
};

/**
 * Раздел владельца платформы.
 *
 * Показывается в том же сайдбаре, что и обычная CRM: держатель platform_owner
 * работает в едином интерфейсе, а не в отдельной панели. Видимость определяется
 * `platform_role`, а не тенантной ролью `owner` — иначе владелец любого арендатора
 * увидел бы платформенные разделы. Backend закрывает те же маршруты гейтом
 * `requirePlatformOwner`, поэтому скрытие здесь косметическое.
 */
export const PLATFORM_NAV: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Все компании", href: "/admin/tenants", icon: Building2 },
  { label: "Тарифы и биллинг", href: "/admin/billing", icon: CreditCard },
  { label: "Метрики системы", href: "/admin/metrics", icon: Activity },
  { label: "Системные логи", href: "/admin/logs", icon: ScrollText },
];

/**
 * Меню блока компании: разделы, относящиеся к аккаунту, а не к данным CRM.
 *
 * Видимость не ограничивается здесь: обе страницы сами закрыты `<Guard>` с
 * `tenant:admin`, а бэкенд — тем же гейтом. Пункт остаётся видимым, чтобы рядовой
 * сотрудник понимал, что раздел существует, но требует прав.
 */
export const TENANT_MENU: {
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
}[] = [
  {
    label: "Мой профиль",
    href: "/settings/profile",
    icon: UserCircle,
    description: "Личные данные, пароль, каналы",
  },
  {
    label: "Сотрудники",
    href: "/settings/team",
    icon: Users,
    description: "Приглашения, роли, доступ",
  },
  {
    label: "Тариф и оплата",
    href: "/settings/billing",
    icon: CreditCard,
    description: "Подписка и детализация счёта",
  },
  {
    label: "Настройки",
    href: "/settings",
    icon: Settings,
    description: "Параметры рабочего пространства",
  },
];

/**
 * Пункт виден, когда модуль установлен И у роли есть право на раздел.
 *
 * Право проверяется в меню, а не только страницей: прежде менеджер видел
 * «Финансы», проходил по ссылке и получал заглушку «нет доступа».
 *
 * `tenant:admin` трактуется как надмножество — так же, как в `useHasPermission` и
 * в `requirePermission` на сервере, иначе меню скрывало бы то, что API разрешает.
 *
 * `permissions === null` означает «сессия ещё восстанавливается»: скрывать в этот
 * момент нельзя, иначе меню мигает при каждой перезагрузке страницы.
 */
export function isNavItemVisible(
  item: NavItem,
  installedSlugs: ReadonlySet<string>,
  permissions: ReadonlySet<string> | null,
): boolean {
  if (item.permission !== undefined && permissions !== null) {
    const allowed = permissions.has(item.permission) || permissions.has("tenant:admin");
    if (!allowed) return false;
  }

  if (item.always || item.moduleSlug === undefined) return true;
  return installedSlugs.has(item.moduleSlug);
}

/**
 * Основной список: ядро → доступные модули → маркетплейс.
 *
 * Порядок часть контракта, а не деталь вёрстки: мобильное меню опирается на тот
 * же список, и расхождение порядка читалось бы как другое меню.
 */
export function visibleMainNav(
  installedSlugs: ReadonlySet<string>,
  permissions: ReadonlySet<string> | null,
): NavItem[] {
  return [
    ...CORE_NAV,
    ...MODULE_NAV.filter((item) => isNavItemVisible(item, installedSlugs, permissions)),
    MARKETPLACE_NAV,
  ];
}

export function visibleChannelNav(
  installedSlugs: ReadonlySet<string>,
  permissions: ReadonlySet<string> | null,
): NavItem[] {
  return CHANNEL_NAV.filter((item) => isNavItemVisible(item, installedSlugs, permissions));
}
