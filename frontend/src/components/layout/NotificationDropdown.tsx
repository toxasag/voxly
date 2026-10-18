"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bell, MessageSquare, Wrench, CreditCard, CircleCheckBig, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppNotification } from "@/types";

const MOCK_NOTIFICATIONS: AppNotification[] = [
  {
    id: "n1",
    category: "message",
    entity_type: "deal",
    entity_id: "d1",
    title: "Новое сообщение в Telegram",
    description: "Мария Соколова: «Когда можно начать?» — сделка Enterprise CRM",
    created_at: "5 мин назад",
    read: false,
  },
  {
    id: "n2",
    category: "repair",
    entity_type: "repair",
    entity_id: "r4",
    title: "Наряд-заказ готов к выдаче",
    description: "REP-00039 Sony WH-1000XM5 — готов к выдаче",
    created_at: "1 ч назад",
    read: false,
  },
  {
    id: "n3",
    category: "payment",
    entity_type: "invoice",
    entity_id: "inv2",
    title: "Счёт оплачен",
    description: "INV-2026-0041 · RetailGroup — 384 000 ₽ оплачен",
    created_at: "3 ч назад",
    read: false,
  },
  {
    id: "n4",
    category: "system",
    entity_type: "system",
    entity_id: "s1",
    title: "Недельный отчёт готов",
    description: "Отчёт по воронке продаж за неделю готов",
    created_at: "1 д назад",
    read: true,
  },
];

const CATEGORY_ICONS = {
  message: MessageSquare,
  repair: Wrench,
  payment: CreditCard,
  system: CircleCheckBig,
} as const;

const ENTITY_HREF: Record<string, (id: string) => string> = {
  deal: (id) => `/crm/deals/${id}`,
  repair: (id) => `/repairs/${id}`,
  invoice: (id) => `/finance?invoice=${id}`,
  contact: (id) => `/crm/contacts/${id}`,
  system: () => "/dashboard",
};

interface NotificationDropdownProps {
  className?: string;
}

export function NotificationDropdown({ className }: NotificationDropdownProps) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>(MOCK_NOTIFICATIONS);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    toast.success("Все уведомления прочитаны");
  }, []);

  const markOneRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const handleNavigate = useCallback(
    (n: AppNotification) => {
      markOneRead(n.id);
      setOpen(false);
      const href = ENTITY_HREF[n.entity_type]?.(n.entity_id) ?? "/dashboard";
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
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "relative rounded-lg p-2 transition-colors",
          open ? "bg-[#f5f5f5] text-[#111111]" : "text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111]",
        )}
        aria-label="Уведомления"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#4a38f5] px-1 text-xs font-bold text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-[#e5e5e5] bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-[#e5e5e5] px-4 py-3">
            <span className="text-sm font-semibold text-[#111111]">Уведомления</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs text-[#4a38f5] transition-colors hover:text-[#3d2ee0]"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Прочитать все
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 && (
              <div className="px-4 py-8 text-center">
                <Bell className="mx-auto mb-2 h-6 w-6 text-[#888888]" />
                <p className="text-sm text-[#666666]">Уведомлений пока нет</p>
              </div>
            )}

            {notifications.map((n) => {
              const Icon = CATEGORY_ICONS[n.category];
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleNavigate(n)}
                  className={cn(
                    "flex w-full items-start gap-3 border-b border-[#f0f0f0] px-4 py-3 text-left transition-colors hover:bg-[#fafafa]",
                    !n.read && "bg-[#4a38f5]/5",
                  )}
                >
                  <div
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                      !n.read
                        ? "border-[#4a38f5]/30 bg-[#4a38f5]/10 text-[#4a38f5]"
                        : "border-[#e5e5e5] bg-[#fafafa] text-[#666666]",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium text-[#111111]">
                      {n.title}
                      {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#4a38f5]" />}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-[#666666]">{n.description}</p>
                    <span className="mt-1 block text-xs text-[#888888]">{n.created_at}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
