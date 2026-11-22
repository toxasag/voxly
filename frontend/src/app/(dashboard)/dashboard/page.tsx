"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  Handshake,
  Users,
  Building2,
  ListChecks,
  ArrowRight,
  Clock,
  CheckCircle2,
  Circle,
  ExternalLink,
} from "lucide-react";
import { useAuth } from "@/lib/auth/use-auth";
import { useDeals, type DealDTO } from "@/lib/api/use-deals";
import { useContacts } from "@/lib/api/use-contacts";
import { useCompanies } from "@/lib/api/use-companies";
import { useTasks, useToggleTaskStatus, type TaskDTO } from "@/lib/api/use-tasks";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { cn, formatDateTime, timeAgo } from "@/lib/utils";
import { toast } from "sonner";

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

const MODULE_LINKS: Record<string, string> = {
  service_center: "/repairs",
  products_services: "/warehouse",
  finance: "/finance",
  ai_bots: "/modules/ai-bots",
  sites: "/channels/sites",
  telegram: "/integrations/telegram",
  whatsapp: "/integrations/whatsapp",
  max: "/integrations/max",
  webchat: "/integrations/webchat",
};

export default function DashboardPage() {
  const { user, tenant } = useAuth();
  const displayUser = user ?? { name: "" };
  const displayTenant = tenant ?? { tenantName: "", plan: "", installedModules: [] };

  // Реальные данные CRM
  const dealsQuery = useDeals({ limit: 5 });
  const contactsQuery = useContacts({ limit: 1 });
  const companiesQuery = useCompanies({ limit: 1 });
  const tasksQuery = useTasks({ limit: 5, status: "todo" });
  const toggleTaskMutation = useToggleTaskStatus();

  const totalDealsCount = dealsQuery.data?.total ?? 0;
  const totalContactsCount = contactsQuery.data?.total ?? 0;
  const totalCompaniesCount = companiesQuery.data?.total ?? 0;
  const totalTasksCount = tasksQuery.data?.total ?? 0;

  const recentDeals = useMemo(() => dealsQuery.data?.items ?? [], [dealsQuery.data]);
  const upcomingTasks = useMemo(() => tasksQuery.data?.items ?? [], [tasksQuery.data]);

  // Суммарный бюджет последних активных сделок
  const dealsBudgetSum = useMemo(() => {
    return recentDeals.reduce((sum, d) => sum + (d.budget || 0), 0);
  }, [recentDeals]);

  const handleToggleTask = async (task: TaskDTO) => {
    const nextStatus = task.status === "done" ? "todo" : "done";
    try {
      await toggleTaskMutation.mutateAsync({ id: task.id, status: nextStatus });
      toast.success(nextStatus === "done" ? "Задача выполнена" : "Задача возвращена в работу");
    } catch {
      toast.error("Не удалось обновить статус задачи");
    }
  };

  return (
    <div className="space-y-6">
      {/* Приветствие */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[17px] font-semibold text-[#111111]">
            С возвращением, {displayUser.name ? displayUser.name.split(" ")[0] : "Коллега"}
          </h1>
          <p className="mt-1 text-xs text-[#666666]">
            {displayTenant.tenantName || "Рабочее пространство"} — тариф {displayTenant.plan || "Базовый"}
          </p>
        </div>
      </div>

      {/* 4 Карточки ключевых показателей с живыми данными */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Сделки */}
        <Link
          href="/crm/deals"
          className="group rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs transition-colors hover:border-[#cccccc]"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#666666]">Всего сделок</span>
            <div className="rounded-[6px] border border-[#f0f0f0] bg-[#fafafa] p-1.5 transition-colors group-hover:bg-[#f0f0f0]">
              <Handshake className="h-4 w-4 text-[#666666]" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            {dealsQuery.isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <span className="text-xl font-semibold font-mono tabular-nums text-[#111111]">
                {totalDealsCount}
              </span>
            )}
            <span className="text-[11px] font-medium text-[#666666]">
              {dealsBudgetSum > 0 ? formatMoney(dealsBudgetSum) : "В воронке"}
            </span>
          </div>
        </Link>

        {/* Контакты */}
        <Link
          href="/crm/contacts"
          className="group rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs transition-colors hover:border-[#cccccc]"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#666666]">Клиентская база</span>
            <div className="rounded-[6px] border border-[#f0f0f0] bg-[#fafafa] p-1.5 transition-colors group-hover:bg-[#f0f0f0]">
              <Users className="h-4 w-4 text-[#666666]" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            {contactsQuery.isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <span className="text-xl font-semibold font-mono tabular-nums text-[#111111]">
                {totalContactsCount}
              </span>
            )}
            <span className="text-[11px] font-medium text-[#666666]">Контакты</span>
          </div>
        </Link>

        {/* Компании */}
        <Link
          href="/crm/companies"
          className="group rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs transition-colors hover:border-[#cccccc]"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#666666]">Компании</span>
            <div className="rounded-[6px] border border-[#f0f0f0] bg-[#fafafa] p-1.5 transition-colors group-hover:bg-[#f0f0f0]">
              <Building2 className="h-4 w-4 text-[#666666]" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            {companiesQuery.isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <span className="text-xl font-semibold font-mono tabular-nums text-[#111111]">
                {totalCompaniesCount}
              </span>
            )}
            <span className="text-[11px] font-medium text-[#666666]">Организации</span>
          </div>
        </Link>

        {/* Задачи */}
        <Link
          href="/crm/tasks"
          className="group rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs transition-colors hover:border-[#cccccc]"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#666666]">Открытые задачи</span>
            <div className="rounded-[6px] border border-[#f0f0f0] bg-[#fafafa] p-1.5 transition-colors group-hover:bg-[#f0f0f0]">
              <ListChecks className="h-4 w-4 text-[#666666]" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            {tasksQuery.isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <span className="text-xl font-semibold font-mono tabular-nums text-[#111111]">
                {totalTasksCount}
              </span>
            )}
            <span className="text-[11px] font-medium text-[#666666]">В работе</span>
          </div>
        </Link>
      </div>

      {/* 2 Секции: Последние сделки и Ближайшие задачи */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Последние сделки */}
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[#f0f0f0]">
              <div className="flex items-center gap-2">
                <Handshake className="h-4 w-4 text-[#4a38f5]" />
                <h2 className="text-[13px] font-semibold text-[#111111]">Последние сделки</h2>
              </div>
              <Link
                href="/crm/deals"
                className="inline-flex items-center gap-1 text-xs font-medium text-[#4a38f5] hover:text-[#3d2ee0] transition-colors"
              >
                Все сделки
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            <div className="mt-3 divide-y divide-[#f5f5f5]">
              {dealsQuery.isLoading ? (
                <div className="space-y-3 py-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : recentDeals.length === 0 ? (
                <div className="py-6">
                  <EmptyState
                    icon={Handshake}
                    title="Сделок пока нет"
                    description="Создайте первую сделку, чтобы начать отслеживать воронку продаж."
                  />
                </div>
              ) : (
                recentDeals.map((deal: DealDTO) => (
                  <Link
                    key={deal.id}
                    href={`/crm/deals?record=${deal.id}`}
                    className="flex items-center justify-between py-2.5 px-1 hover:bg-[#fafafa] rounded-[6px] transition-colors group"
                  >
                    <div className="min-w-0 pr-3">
                      <p className="text-[13px] font-medium text-[#111111] truncate group-hover:text-[#4a38f5] transition-colors">
                        {deal.title}
                      </p>
                      <p className="text-[11px] text-[#666666] truncate mt-0.5">
                        {deal.contactName || deal.companyName || "Без контакта"} • {timeAgo(deal.createdAt)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-mono text-xs font-semibold tabular-nums text-[#111111]">
                        {formatMoney(deal.budget || 0)}
                      </span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Ближайшие задачи */}
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[#f0f0f0]">
              <div className="flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-[#4a38f5]" />
                <h2 className="text-[13px] font-semibold text-[#111111]">Ближайшие задачи</h2>
              </div>
              <Link
                href="/crm/tasks"
                className="inline-flex items-center gap-1 text-xs font-medium text-[#4a38f5] hover:text-[#3d2ee0] transition-colors"
              >
                Все задачи
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            <div className="mt-3 divide-y divide-[#f5f5f5]">
              {tasksQuery.isLoading ? (
                <div className="space-y-3 py-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : upcomingTasks.length === 0 ? (
                <div className="py-6">
                  <EmptyState
                    icon={ListChecks}
                    title="Все задачи выполнены"
                    description="Новые запланированные дела и напоминания появятся здесь."
                  />
                </div>
              ) : (
                upcomingTasks.map((task: TaskDTO) => {
                  const isCompleted = task.status === "done";
                  return (
                    <div
                      key={task.id}
                      className="flex items-center justify-between py-2.5 px-1 hover:bg-[#fafafa] rounded-[6px] transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 pr-3">
                        <button
                          type="button"
                          onClick={() => void handleToggleTask(task)}
                          className="shrink-0 text-[#888888] hover:text-[#4a38f5] transition-colors"
                          aria-label={isCompleted ? "Отметить невыполненной" : "Отметить выполненной"}
                        >
                          {isCompleted ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <Circle className="h-4 w-4" />
                          )}
                        </button>
                        <div className="min-w-0">
                          <p
                            className={cn(
                              "text-[13px] font-medium truncate",
                              isCompleted ? "line-through text-[#888888]" : "text-[#111111]"
                            )}
                          >
                            {task.title}
                          </p>
                          {task.dueDate && (
                            <p className="flex items-center gap-1 text-[11px] text-[#666666] mt-0.5">
                              <Clock className="h-3 w-3" />
                              {formatDateTime(task.dueDate)}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0">
                        {task.priority === "high" && (
                          <span className="rounded-[4px] border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
                            Срочно
                          </span>
                        )}
                        {task.priority === "medium" && (
                          <span className="rounded-[4px] border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                            Средний
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Установленные модули */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="h-4 w-4 text-[#888888]" />
            <h2 className="text-[13px] font-semibold text-[#111111]">Активные модули платформы</h2>
          </div>
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-1 text-xs font-medium text-[#4a38f5] hover:text-[#3d2ee0] transition-colors"
          >
            Маркетплейс
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {displayTenant.installedModules && displayTenant.installedModules.length > 0 ? (
            displayTenant.installedModules.map((mod) => {
              const targetHref = MODULE_LINKS[mod.slug] || "/marketplace";
              return (
                <Link
                  key={mod.slug}
                  href={targetHref}
                  className="rounded-[6px] bg-[#4a38f5]/10 px-3 py-1.5 text-xs font-medium text-[#4a38f5] border border-[#4a38f5]/20 hover:bg-[#4a38f5]/15 transition-colors"
                >
                  {mod.name}
                </Link>
              );
            })
          ) : (
            <p className="text-xs text-[#888888]">Базовый комплект CRM активен.</p>
          )}
        </div>
      </div>
    </div>
  );
}
