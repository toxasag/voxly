"use client";

import Link from "next/link";
import {
  Bot,
  ChevronRight,
  CreditCard,
  Gift,
  UserCircle,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Guard } from "@/components/shared/Guard";
import { pluralDays, useTenantInfo } from "@/lib/api/use-team";
import type { Permission } from "@/types";

// ---------------------------------------------------------------------------
// Индекс настроек.
//
// Нужен потому, что пункт «Настройки» в сайдбаре ведёт на /settings: без этой
// страницы он отдавал бы 404. Заодно собирает разделы, которые прежде
// существовали, но были недостижимы из навигации (/settings/ai,
// /settings/referral).
// ---------------------------------------------------------------------------

interface SettingsLink {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  /** Если задано — пункт показывается только при наличии права. */
  permission?: Permission;
}

const SECTIONS: SettingsLink[] = [
  {
    label: "Мой профиль",
    description: "Личные данные, пароль и каналы для входа",
    href: "/settings/profile",
    icon: UserCircle,
  },
  {
    label: "Сотрудники",
    description: "Приглашения, роли и доступ к разделам",
    href: "/settings/team",
    icon: Users,
    permission: "tenant:admin",
  },
  {
    label: "Тариф и оплата",
    description: "Подписка, детализация счёта, способы оплаты",
    href: "/settings/billing",
    icon: CreditCard,
    permission: "tenant:admin",
  },
  {
    // Ведёт в модуль, а не в /settings/ai: настройка агентов живёт там, где сами
    // агенты. Прежний экран был вторым редактором на моках и правил один
    // захардкоженный агент, которого нет в БД.
    label: "AI-агенты",
    description: "Модель, промпт и привязка к каналам",
    href: "/modules/ai-bots",
    icon: Bot,
  },
  {
    label: "Партнёрская программа",
    description: "Реферальная ссылка и выплаты",
    href: "/settings/referral",
    icon: Gift,
  },
];

function SectionCard({ section }: { section: SettingsLink }) {
  return (
    <Link
      href={section.href}
      className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-900 p-5 transition-colors hover:border-slate-700 hover:bg-slate-800/50"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-800">
        <section.icon className="h-5 w-5 text-slate-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-100">{section.label}</p>
        <p className="mt-0.5 text-xs text-slate-500">{section.description}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" />
    </Link>
  );
}

export default function SettingsIndexPage() {
  const { data: info } = useTenantInfo();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Настройки</h1>
        <p className="mt-1 text-sm text-slate-400">
          {info === undefined
            ? "Управление рабочим пространством"
            : `${info.name} · ${info.slug}.getvoxly.ru`}
        </p>
      </div>

      {info !== undefined && info.trialActive && (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-5 py-4">
          <Gift className="h-4 w-4 shrink-0 text-emerald-400" />
          <p className="text-sm text-slate-300">
            Пробный период: осталось{" "}
            <span className="font-semibold text-emerald-400">
              {info.trialDaysLeft} {pluralDays(info.trialDaysLeft)}
            </span>
            .{" "}
            <Link href="/settings/billing" className="text-amber-500 hover:text-amber-400">
              Посмотреть тариф
            </Link>
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map((section) =>
          section.permission === undefined ? (
            <SectionCard key={section.href} section={section} />
          ) : (
            // Пункт скрывается, а не блокируется: недоступный элемент без
            // объяснения читается как поломка.
            <Guard key={section.href} requiredPermission={section.permission}>
              <SectionCard section={section} />
            </Guard>
          ),
        )}
      </div>
    </div>
  );
}
