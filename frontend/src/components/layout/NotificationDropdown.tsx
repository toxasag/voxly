"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Bell,
  MessageSquare,
  Wrench,
  CreditCard,
  CircleCheckBig,
  Check,
  Handshake,
  CheckSquare,
  Sparkles,
  Settings,
  Smartphone,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppNotification, NotificationCategory } from "@/types";
import { useInAppNotifications } from "@/lib/notifications/use-inapp-notifications";
import { useWebPush } from "@/lib/notifications/use-web-push";

const CATEGORY_CONFIG: Record<
  NotificationCategory,
  {
    icon: typeof MessageSquare;
    bgClass: string;
    iconClass: string;
  }
> = {
  message: {
    icon: MessageSquare,
    bgClass: "bg-[#eef2ff] border-[#e0e7ff]",
    iconClass: "text-[#4a38f5]",
  },
  lead: {
    icon: Handshake,
    bgClass: "bg-[#f0fdf4] border-[#dcfce7]",
    iconClass: "text-[#16a34a]",
  },
  task: {
    icon: CheckSquare,
    bgClass: "bg-[#eff6ff] border-[#dbeafe]",
    iconClass: "text-[#2563eb]",
  },
  repair: {
    icon: Wrench,
    bgClass: "bg-[#f5f3ff] border-[#ede9fe]",
    iconClass: "text-[#7c3aed]",
  },
  payment: {
    icon: CreditCard,
    bgClass: "bg-[#fdf4ff] border-[#fae8ff]",
    iconClass: "text-[#c026d3]",
  },
  system: {
    icon: CircleCheckBig,
    bgClass: "bg-[#f8fafc] border-[#f1f5f9]",
    iconClass: "text-[#64748b]",
  },
};

const ENTITY_HREF: Record<string, (id: string) => string> = {
  deal: (id) => `/crm/deals/${id}`,
  lead: (id) => `/crm/deals/${id}`,
  chat: (id) => `/crm/deals/${id}`,
  task: (id) => `/crm/tasks?record=${id}`,
  repair: (id) => `/repairs/${id}`,
  invoice: (id) => `/finance?invoice=${id}`,
  contact: (id) => `/crm/contacts/${id}`,
  system: () => "/dashboard",
};

function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;

    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffSec < 60) return "только что";
    if (diffSec < 3600) {
      const minutes = Math.floor(diffSec / 60);
      return `${minutes} мин назад`;
    }
    if (diffSec < 86400) {
      const hours = Math.floor(diffSec / 3600);
      return `${hours} ч назад`;
    }
    const days = Math.floor(diffSec / 86400);
    if (days === 1) return "вчера";
    if (days < 7) return `${days} д назад`;

    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "short",
    }).format(date);
  } catch {
    return dateString;
  }
}

interface NotificationDropdownProps {
  className?: string;
}

export function NotificationDropdown({ className }: NotificationDropdownProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const { notifications, unreadCount, markAllRead, markOneRead } = useInAppNotifications();
  const { isSupported, isSubscribed, subscribe, isLoading: isPushLoading } = useWebPush();

  const handleNavigate = useCallback(
    (n: AppNotification) => {
      markOneRead(n.id);
      setOpen(false);
      const urlFromData = n.data?.url as string | undefined;
      const href = urlFromData || (ENTITY_HREF[n.entity_type]?.(n.entity_id) ?? "/dashboard");
      router.push(href);
    },
    [markOneRead, router],
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className={cn("relative", className)} ref={dropdownRef}>
      {/* Кнопка колокольчика со счётчиком непрочитанных */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "relative flex h-8 w-8 items-center justify-center rounded-xl transition-all",
          open
            ? "border-2 border-[#4a38f5] bg-[#f5f5f5] text-[#111111]"
            : "border border-transparent text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111]",
        )}
        aria-label="Уведомления"
      >
        <Bell className="h-4.5 w-4.5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#4a38f5] px-1 text-[10px] font-bold text-white shadow-xs">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Выпадающее окно уведомлений (соответствует дизайну на скриншоте) */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-84 sm:w-96 rounded-2xl border border-[#e5e5e5] bg-white shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          {/* Шапка */}
          <div className="flex items-center justify-between border-b border-[#e5e5e5] px-4 py-3 bg-white">
            <span className="text-[14px] font-semibold text-[#111111]">Уведомления</span>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={markAllRead}
                className="flex items-center gap-1 text-[12px] font-medium text-[#4a38f5] transition-colors hover:text-[#3d2ee0]"
              >
                <Check className="h-3.5 w-3.5" />
                <span>Прочитать все</span>
              </button>
            ) : (
              <span className="text-[11px] text-[#888888]">Все прочитаны</span>
            )}
          </div>

          {/* Список уведомлений */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-[#f0f0f0]">
            {notifications.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[#fafafa] text-[#888888]">
                  <Bell className="h-5 w-5" />
                </div>
                <p className="text-[13px] font-medium text-[#111111]">Уведомлений пока нет</p>
                <p className="text-[12px] text-[#888888] mt-0.5">
                  Новые заявки, сообщения и задачи будут отображаться здесь
                </p>
              </div>
            ) : (
              notifications.map((n) => {
                const config = CATEGORY_CONFIG[n.category] ?? CATEGORY_CONFIG.system;
                const Icon = config.icon;

                return (
                  <div
                    key={n.id}
                    onClick={() => handleNavigate(n)}
                    className={cn(
                      "flex items-start gap-3 p-3.5 transition-colors cursor-pointer",
                      n.read ? "bg-white hover:bg-[#fafafa]" : "bg-[#fcfcff] hover:bg-[#f6f7ff]",
                    )}
                  >
                    {/* Иконка в скругленном квадрате */}
                    <div
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
                        config.bgClass,
                      )}
                    >
                      <Icon className={cn("h-4.5 w-4.5", config.iconClass)} />
                    </div>

                    {/* Текстовая колонка */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="truncate text-[13px] font-semibold text-[#111111]">
                          {n.title}
                        </span>
                        {!n.read && (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-[#4a38f5]" />
                        )}
                      </div>
                      <p className="mt-0.5 text-[12px] leading-snug text-[#555555] line-clamp-2">
                        {n.description}
                      </p>
                      <span className="mt-1 block text-[11px] text-[#888888]">
                        {formatRelativeTime(n.created_at)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Нижняя панель: статус Web Push и ссылка в настройки */}
          <div className="border-t border-[#e5e5e5] bg-[#fafafa] p-3 space-y-2">
            {isSupported && !isSubscribed && (
              <div className="flex items-center justify-between rounded-xl border border-sky-200 bg-sky-50 px-2.5 py-1.5">
                <div className="flex items-center gap-2 text-[11px] text-sky-900">
                  <Smartphone className="h-3.5 w-3.5 text-sky-600 shrink-0" />
                  <span>Включить Push на этом устройстве</span>
                </div>
                <button
                  type="button"
                  onClick={() => void subscribe()}
                  disabled={isPushLoading}
                  className="rounded-lg bg-sky-600 px-2 py-0.5 text-[11px] font-medium text-white shadow-xs hover:bg-sky-700 transition-colors disabled:opacity-50"
                >
                  Включить
                </button>
              </div>
            )}

            <div className="flex items-center justify-between text-[11px] text-[#666666]">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "inline-block h-2 w-2 rounded-full",
                    isSubscribed ? "bg-emerald-500" : "bg-neutral-300",
                  )}
                />
                <span>
                  {isSubscribed ? "Web Push активен" : "Web Push не подключён"}
                </span>
              </div>
              <Link
                href="/settings/notifications"
                onClick={() => setOpen(false)}
                className="flex items-center gap-1 text-[#4a38f5] hover:text-[#3d2ee0] transition-colors"
              >
                <span>Настройки</span>
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
