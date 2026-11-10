"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Building2,
  DollarSign,
  Loader2,
  LogIn,
  RefreshCw,
  Search,
  Settings,
  Tag,
  Trash2,
  TrendingUp,
  X,
  Bot,
  Briefcase,
  CornerDownRight,
  Users,
  CheckCircle2,
} from "lucide-react";
import { PlatformOwnerGuard } from "@/components/auth/PlatformOwnerGuard";
import {
  renewSubscriptionDate,
  useAdminTenants,
  useDeleteTenant,
  useImpersonateTenant,
  useUpdateTenant,
  type AdminTenantDTO,
} from "@/lib/api/use-admin";
import { readAccessToken, readRefreshToken, writeTokens } from "@/lib/auth/session";
import { writeImpersonationBackup, type ImpersonationBackup } from "@/lib/auth/impersonation";
import { useAuth } from "@/lib/auth/use-auth";
import { tenantPortalUrl } from "@/lib/auth/tenant-host";
import { TenantManageModal } from "@/components/admin/TenantManageModal";
import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonTable } from "@/components/shared/Skeleton";
import { cn } from "@/lib/utils";
import { useOverlay } from "@/lib/utils/use-scroll-lock";

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  trial: "bg-amber-50 text-amber-700 border-amber-200",
  past_due: "bg-rose-50 text-rose-700 border-rose-200",
  suspended: "bg-[#fafafa] text-[#666666] border-[#e5e5e5]",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Активен",
  trial: "Пробный",
  past_due: "Просрочен",
  suspended: "Приостановлен",
};

function formatDate(value: string | null): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(new Date(value));
}

function formatRubles(kopecks: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: kopecks % 100 === 0 ? 0 : 2,
  }).format(kopecks / 100);
}

function DeleteTenantDialog({
  tenant,
  open,
  onClose,
  onDeleted,
}: {
  tenant: AdminTenantDTO | null;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const deleteMutation = useDeleteTenant();
  const [confirmText, setConfirmText] = useState("");

  useOverlay(open, { onEscape: onClose });

  useEffect(() => {
    if (open) {
      setConfirmText("");
    }
  }, [open, tenant]);

  if (!open || !tenant) return null;

  const targetName = tenant.name.trim();
  const isMatch =
    confirmText.trim().toLowerCase() === "удалить" ||
    confirmText.trim().toLowerCase() === targetName.toLowerCase();

  const handleDelete = async () => {
    if (!isMatch || deleteMutation.isPending) return;

    try {
      await deleteMutation.mutateAsync(tenant.id);
      toast.success(`Компания «${tenant.name}» успешно и полностью удалена`);
      onDeleted();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить компанию");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-[16px] border border-[#e5e5e5] bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-50 border border-rose-200 text-rose-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#111111]">
                Полное удаление компании
              </h2>
              <p className="text-xs text-[#666666]">
                Безвозвратное уничтожение всех данных компании
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] p-1 text-[#888888] hover:bg-[#fafafa] hover:text-[#111111] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-[8px] border border-rose-200 bg-rose-50/40 p-3.5">
          <p className="text-sm font-semibold text-[#111111]">{tenant.name}</p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#666666]">
            {tenant.slug && (
              <span>
                Слаг: <span className="font-mono text-[#111111]">{tenant.slug}</span>
              </span>
            )}
            <span>
              Пользователей: <span className="font-mono text-[#111111]">{tenant.users_count}</span>
            </span>
            <span>
              Модулей: <span className="font-mono text-[#111111]">{tenant.modules_count}</span>
            </span>
            <span>
              Тариф: <span className="capitalize text-[#111111]">{tenant.plan}</span>
            </span>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium text-[#111111]">
            Будут окончательно и безвозвратно удалены:
          </p>
          <ul className="space-y-1.5 text-xs text-[#666666]">
            <li className="flex items-start gap-1.5">
              <span className="text-rose-500 font-bold">•</span>
              <span>Все учётные записи сотрудников компании ({tenant.users_count}) и сессии</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-rose-500 font-bold">•</span>
              <span>Вся база CRM: контакты, компании, сделки, задачи и воронки</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-rose-500 font-bold">•</span>
              <span>Подключенные каналы связи (Telegram, WhatsApp)</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-rose-500 font-bold">•</span>
              <span>База знаний, векторные эмбеддинги, AI-боты и файлы вложений</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-rose-500 font-bold">•</span>
              <span>Заказ-наряды сервисного центра, счета, кассы и история транзакций</span>
            </li>
          </ul>
        </div>

        <div className="mt-5 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3">
          <label className="block text-xs font-medium text-[#111111]">
            Для подтверждения введите слово <span className="font-semibold text-rose-600">удалить</span> или имя «{tenant.name}»:
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={tenant.name}
            className="mt-2 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500/20"
            autoFocus
          />
        </div>

        <div className="mt-6 flex items-center justify-end gap-2 border-t border-[#e5e5e5] pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={deleteMutation.isPending}
            className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] transition-colors hover:bg-[#fafafa] disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={!isMatch || deleteMutation.isPending}
            className="flex h-8 items-center gap-1.5 rounded-[8px] border border-rose-600 bg-rose-600 px-3.5 text-xs font-medium text-white shadow-xs transition-colors hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {deleteMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            <span>Удалить компанию навсегда</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminTenantsPage() {
  const queryClient = useQueryClient();
  const { user: currentAdminUser } = useAuth();
  const isPlatformOwner = currentAdminUser?.platform_role === "platform_owner";
  const { data: tenants = [], isLoading, isError, error, refetch, isFetching } = useAdminTenants({
    enabled: isPlatformOwner,
  });
  const update = useUpdateTenant();
  const impersonate = useImpersonateTenant();

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [managingTenant, setManagingTenant] = useState<AdminTenantDTO | null>(null);
  const [deletingTenant, setDeletingTenant] = useState<AdminTenantDTO | null>(null);

  // Фильтры и поиск
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [planFilter, setPlanFilter] = useState<string>("all");
  const [nicheFilter, setNicheFilter] = useState<string>("all");
  const [adoptionFilter, setAdoptionFilter] = useState<string>("all");

  // Статистические показатели платформы
  const stats = useMemo(() => {
    const total = tenants.length;
    let active = 0;
    let trial = 0;
    let suspended = 0;
    let customPriced = 0;
    let partnerCount = 0;
    let clientCount = 0;
    let freePartners = 0;
    let freeClients = 0;
    let totalAdoption = 0;
    let highAdoption = 0;
    let lowAdoption = 0;
    let totalAiAgents = 0;
    let activeAiAgents = 0;
    let totalAiBalanceKopecks = 0;
    let totalAiSpentMonthKopecks = 0;

    const nicheCounts: Record<string, number> = {};

    for (const t of tenants) {
      if (t.status === "active") active++;
      else if (t.status === "trial") trial++;
      else if (t.status === "suspended") suspended++;

      const isPartner = (t.is_partner || t.tenant_type === "partner") && t.slug !== "voxly";
      if (isPartner) {
        partnerCount++;
        if (t.custom_price_rubles === 0) freePartners++;
      } else if (t.slug !== "voxly") {
        clientCount++;
        if (t.custom_price_rubles === 0) freeClients++;
      }

      if (t.custom_price_rubles !== null || t.custom_plan_name) {
        customPriced++;
      }

      totalAdoption += t.adoption_score || 0;
      if (t.adoption_score >= 80) highAdoption++;
      else if (t.adoption_score < 40) lowAdoption++;

      totalAiAgents += t.ai_agents_count || 0;
      activeAiAgents += t.ai_active_agents_count || 0;
      totalAiBalanceKopecks += t.ai_balance_kopecks || 0;
      totalAiSpentMonthKopecks += t.ai_spent_month_kopecks || 0;

      if (t.business_niche) {
        nicheCounts[t.business_niche] = (nicheCounts[t.business_niche] || 0) + 1;
      }
    }

    const avgAdoption = total > 0 ? Math.round(totalAdoption / total) : 0;
    const sortedNiches = Object.entries(nicheCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    return {
      total,
      active,
      trial,
      suspended,
      customPriced,
      partnerCount,
      clientCount,
      freePartners,
      freeClients,
      avgAdoption,
      highAdoption,
      lowAdoption,
      totalAiAgents,
      activeAiAgents,
      totalAiBalanceKopecks,
      totalAiSpentMonthKopecks,
      topNiches: sortedNiches,
      allNiches: Object.keys(nicheCounts),
    };
  }, [tenants]);

  // Фильтрация тенантов
  const filteredTenants = useMemo(() => {
    return tenants.filter((t) => {
      // Поиск
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesName = t.name.toLowerCase().includes(q);
        const matchesSlug = t.slug?.toLowerCase().includes(q);
        const matchesOwner = t.owner_email?.toLowerCase().includes(q) || t.owner_name?.toLowerCase().includes(q);
        const matchesNiche = t.business_niche?.toLowerCase().includes(q);
        const matchesPlan = t.custom_plan_name?.toLowerCase().includes(q) || t.plan.toLowerCase().includes(q);
        const matchesParent =
          t.parent_tenant_name?.toLowerCase().includes(q) ||
          t.parent_tenant_slug?.toLowerCase().includes(q);
        if (!matchesName && !matchesSlug && !matchesOwner && !matchesNiche && !matchesPlan && !matchesParent) {
          return false;
        }
      }

      // Фильтр по роли / типу
      if (typeFilter === "partners") {
        const isPartner = (t.is_partner || t.tenant_type === "partner") && t.slug !== "voxly";
        if (!isPartner) return false;
      } else if (typeFilter === "sub_clients") {
        const isPartner = (t.is_partner || t.tenant_type === "partner") && t.slug !== "voxly";
        const hasParent = Boolean(t.parent_tenant_id || t.owner_partner_id);
        if (isPartner || !hasParent) return false;
      } else if (typeFilter === "direct_clients") {
        const isPartner = (t.is_partner || t.tenant_type === "partner");
        const hasParent = Boolean(t.parent_tenant_id || t.owner_partner_id);
        if (isPartner || hasParent) return false;
      }

      // Фильтр по статусу
      if (statusFilter !== "all" && t.status !== statusFilter) {
        return false;
      }

      // Фильтр по тарифу
      if (planFilter === "custom") {
        if (t.custom_price_rubles === null && !t.custom_plan_name) return false;
      } else if (planFilter === "free") {
        if (t.custom_price_rubles !== 0) return false;
      } else if (planFilter === "standard") {
        if (t.custom_price_rubles !== null || t.custom_plan_name) return false;
      }

      // Фильтр по нише
      if (nicheFilter !== "all") {
        if (nicheFilter === "none" && t.business_niche) return false;
        if (nicheFilter !== "none" && t.business_niche !== nicheFilter) return false;
      }

      // Фильтр по внедрению
      if (adoptionFilter === "low" && t.adoption_score >= 40) return false;
      if (adoptionFilter === "high" && t.adoption_score < 80) return false;

      return true;
    });
  }, [tenants, search, typeFilter, statusFilter, planFilter, nicheFilter, adoptionFilter]);

  // Иерархическое дерево: Партнёры и их суб-клиенты
  interface HierarchyItem {
    tenant: AdminTenantDTO;
    isPartner: boolean;
    isSubClient: boolean;
    parentPartner?: AdminTenantDTO | null;
    parentPartnerName?: string | null;
    childCount?: number;
  }

  const hierarchicalTenants = useMemo<HierarchyItem[]>(() => {
    const tenantMap = new Map<string, AdminTenantDTO>();
    tenants.forEach((t) => tenantMap.set(t.id, t));

    const partners: AdminTenantDTO[] = [];
    const directClients: AdminTenantDTO[] = [];
    const childrenByPartnerId = new Map<string, AdminTenantDTO[]>();

    for (const t of filteredTenants) {
      const isPartner = (t.is_partner || t.tenant_type === "partner") && t.slug !== "voxly";
      if (isPartner) {
        partners.push(t);
      } else {
        const parentId = t.parent_tenant_id || t.owner_partner_id;
        if (parentId && parentId !== "c0000000-0000-0000-0000-000000000001" && (tenantMap.has(parentId) || t.parent_tenant_name)) {
          const list = childrenByPartnerId.get(parentId) || [];
          list.push(t);
          childrenByPartnerId.set(parentId, list);
        } else {
          directClients.push(t);
        }
      }
    }

    const result: HierarchyItem[] = [];

    // 1. Корневые партнёры и их субклиенты
    for (const partner of partners) {
      const children = childrenByPartnerId.get(partner.id) || [];
      const totalChildrenCount = tenants.filter(
        (t) => (t.parent_tenant_id === partner.id || t.owner_partner_id === partner.id) && t.id !== partner.id,
      ).length;

      result.push({
        tenant: partner,
        isPartner: true,
        isSubClient: false,
        parentPartner: null,
        childCount: totalChildrenCount,
      });

      for (const child of children) {
        result.push({
          tenant: child,
          isPartner: false,
          isSubClient: true,
          parentPartner: partner,
          parentPartnerName: partner.name,
        });
      }
    }

    // 2. Субклиенты, чей партнёр был отфильтрован другим фильтром (например, по нише)
    for (const [parentId, children] of childrenByPartnerId.entries()) {
      if (!partners.some((p) => p.id === parentId)) {
        const parent = tenantMap.get(parentId);
        for (const child of children) {
          result.push({
            tenant: child,
            isPartner: false,
            isSubClient: true,
            parentPartner: parent ?? null,
            parentPartnerName: parent?.name ?? child.parent_tenant_name,
          });
        }
      }
    }

    // 3. Прямые клиенты и платформа voxly
    for (const client of directClients) {
      result.push({
        tenant: client,
        isPartner: (client.is_partner || client.tenant_type === "partner"),
        isSubClient: false,
        parentPartner: null,
      });
    }

    return result;
  }, [tenants, filteredTenants]);

  // Войти под пользователем (Impersonation)
  const handleImpersonate = useCallback(
    async (tenant: AdminTenantDTO) => {
      setPendingId(tenant.id);
      try {
        const currentAccessToken = readAccessToken();

        if (!currentAccessToken) {
          toast.error("Не найден токен авторизации администратора");
          return;
        }

        const res = await impersonate.mutateAsync(tenant.id);

        const newAccessToken = res.accessToken ?? res.access_token;
        const newRefreshToken = res.refreshToken ?? res.refresh_token;

        if (!newAccessToken || !newRefreshToken) {
          throw new Error("Сервер не вернул токены авторизации для арендатора");
        }

        const userEmail = res.user?.email ?? tenant.owner_email ?? "";

        // Сохраняем исходную сессию суперадминистратора в бэкап (domain-scoped cookie + localStorage)
        const targetSlug = tenant.slug || "";
        const adminAccessToken = res.admin_access_token || currentAccessToken;
        const adminRefreshToken = res.admin_refresh_token || adminAccessToken;
        const adminEmail = res.admin_user?.email || currentAdminUser?.email || "";
        const adminName = res.admin_user?.name || currentAdminUser?.name || "";

        const backup: ImpersonationBackup = {
          accessToken: adminAccessToken,
          refreshToken: adminRefreshToken,
          adminUserEmail: adminEmail,
          adminUserName: adminName,
          adminOriginHost: typeof window !== "undefined" ? window.location.host : "",
          impersonatedTenantSlug: targetSlug,
          impersonatedTenantName: tenant.name,
          impersonatedUserEmail: userEmail,
          enteredAt: new Date().toISOString(),
        };
        writeImpersonationBackup(backup);

        // Очищаем кэш запросов, чтобы данные админки не смешивались с данными тенанта
        queryClient.clear();

        // Применяем токен клиента
        writeTokens({
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
        });

        toast.success(`Вход выполнен под организацией «${tenant.name}» ${userEmail ? `(${userEmail})` : ""}`);
        // Переходим напрямую на персональный домен/поддомен арендатора с handoff токена и бэкапа
        const targetUrl = targetSlug ? tenantPortalUrl(targetSlug, "/crm/deals") : "/crm/deals";
        const hashParams = new URLSearchParams();
        hashParams.set("tenant_token", newAccessToken);
        hashParams.set("impersonator_backup", JSON.stringify(backup));
        const redirectUrl = targetUrl.includes("://")
          ? `${targetUrl}#${hashParams.toString()}`
          : targetUrl;
        window.location.href = redirectUrl;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось выполнить вход под аккаунтом клиента");
      } finally {
        setPendingId(null);
      }
    },
    [impersonate, currentAdminUser, queryClient],
  );

  // Переключение статуса
  const handleToggleStatus = useCallback(
    async (tenant: AdminTenantDTO) => {
      const next = tenant.status === "suspended" ? "active" : "suspended";
      setPendingId(tenant.id);

      try {
        await update.mutateAsync({ id: tenant.id, status: next });
        toast.success(
          next === "suspended" ? `Компания «${tenant.name}» приостановлена` : `Компания «${tenant.name}» активирована`,
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось изменить статус");
      } finally {
        setPendingId(null);
      }
    },
    [update],
  );

  // Продление подписки на 30 дней
  const handleRenew = useCallback(
    async (tenant: AdminTenantDTO) => {
      setPendingId(tenant.id);
      try {
        await update.mutateAsync({
          id: tenant.id,
          subscription_expires_at: renewSubscriptionDate(tenant.subscription_expires_at, 30),
          status: "active",
        });
        toast.success(`Подписка «${tenant.name}» продлена на 30 дней`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось продлить подписку");
      } finally {
        setPendingId(null);
      }
    },
    [update],
  );

  return (
    <PlatformOwnerGuard>
      <div className="space-y-6">
        {/* Заголовок страницы */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[#111111]">
              Управление платформой и компаниями
            </h1>
            <p className="mt-0.5 text-xs text-[#666666]">
              Арендаторы платформы, индивидуальные тарифы, ниши бизнеса, AI-боты и полнота внедрения (Adoption)
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] transition-colors hover:bg-[#fafafa] disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            <span>Обновить</span>
          </button>
        </div>

        {/* Сводные блоки платформы (Adoption & Intelligence) */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {/* Блок 1: Компании */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
            <div className="flex items-center justify-between text-[#666666]">
              <span className="text-[11px] font-medium uppercase tracking-wider">Компании</span>
              <Building2 className="h-4 w-4 text-[#4a38f5]" />
            </div>
            <p className="mt-1 text-2xl font-bold font-mono text-[#111111]">{stats.total}</p>
            <div className="mt-2 flex flex-wrap gap-x-2 text-[11px] text-[#666666]">
              <span className="text-emerald-700 font-medium">● {stats.active} акт.</span>
              <span className="text-amber-700 font-medium">● {stats.trial} пробн.</span>
              {stats.suspended > 0 && <span className="text-[#888888]">● {stats.suspended} пауза</span>}
            </div>
          </div>

          {/* Блок 2: Индивидуальные тарифы */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
            <div className="flex items-center justify-between text-[#666666]">
              <span className="text-[11px] font-medium uppercase tracking-wider">Спецтарифы</span>
              <DollarSign className="h-4 w-4 text-emerald-600" />
            </div>
            <p className="mt-1 text-2xl font-bold font-mono text-[#111111]">{stats.customPriced}</p>
            <p className="mt-2 text-[11px] text-[#666666]">
              Партнёров: <strong className="text-[#111111]">{stats.partnerCount}</strong> • Беспл. клиентов: <strong className="text-[#111111]">{stats.freeClients}</strong>
            </p>
          </div>

          {/* Блок 3: Индекс внедрения */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
            <div className="flex items-center justify-between text-[#666666]">
              <span className="text-[11px] font-medium uppercase tracking-wider">Индекс Adoption</span>
              <TrendingUp className="h-4 w-4 text-[#4a38f5]" />
            </div>
            <p className="mt-1 text-2xl font-bold font-mono text-[#111111]">{stats.avgAdoption}%</p>
            <div className="mt-2 flex items-center justify-between text-[11px] text-[#666666]">
              <span className="text-emerald-700 font-medium">{stats.highAdoption} внедрено</span>
              <span className="text-rose-600 font-medium">{stats.lowAdoption} мало функций</span>
            </div>
          </div>

          {/* Блок 4: AI Агенты и Баланс */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
            <div className="flex items-center justify-between text-[#666666]">
              <span className="text-[11px] font-medium uppercase tracking-wider">AI-Автоматизация</span>
              <Bot className="h-4 w-4 text-violet-600" />
            </div>
            <p className="mt-1 text-2xl font-bold font-mono text-[#111111]">{stats.activeAiAgents} / {stats.totalAiAgents}</p>
            <p className="mt-2 text-[11px] text-[#666666] truncate">
              Расход за месяц: <strong className="text-[#111111]">{formatRubles(stats.totalAiSpentMonthKopecks)}</strong>
            </p>
          </div>

          {/* Блок 5: Сферы бизнеса */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
            <div className="flex items-center justify-between text-[#666666]">
              <span className="text-[11px] font-medium uppercase tracking-wider">Ниши клиентов</span>
              <Tag className="h-4 w-4 text-sky-600" />
            </div>
            <div className="mt-1 space-y-1">
              {stats.topNiches.length > 0 ? (
                stats.topNiches.map(([niche, count]) => (
                  <div key={niche} className="flex items-center justify-between text-[11px] text-[#666666]">
                    <span className="truncate max-w-[120px]" title={niche}>{niche}</span>
                    <span className="font-mono font-medium text-[#111111]">{count}</span>
                  </div>
                ))
              ) : (
                <p className="text-[11px] text-[#888888] pt-2">Ниши ещё не указаны</p>
              )}
            </div>
          </div>
        </div>

        {/* Панель фильтров и поиска */}
        <div className="flex flex-wrap items-center gap-2.5 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3">
          {/* Поиск */}
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[#888888]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по компании, слагу, нише, владельцу..."
              className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white pl-8 pr-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-2 text-[#888888] hover:text-[#111111]"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Фильтр по роли / типу компании */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
          >
            <option value="all">Все типы компаний</option>
            <option value="partners">Только партнёры</option>
            <option value="sub_clients">Клиенты партнёров</option>
            <option value="direct_clients">Прямые клиенты платформы</option>
          </select>

          {/* Фильтр по статусу */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
          >
            <option value="all">Все статусы</option>
            <option value="active">Активные</option>
            <option value="trial">Пробные</option>
            <option value="suspended">Приостановленные</option>
            <option value="past_due">Просроченные</option>
          </select>

          {/* Фильтр по тарифу */}
          <select
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
            className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
          >
            <option value="all">Все тарифы</option>
            <option value="custom">Индивидуальные / Спец</option>
            <option value="free">Бесплатные (0 ₽)</option>
            <option value="standard">Стандартные планы</option>
          </select>

          {/* Фильтр по нише */}
          <select
            value={nicheFilter}
            onChange={(e) => setNicheFilter(e.target.value)}
            className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
          >
            <option value="all">Все ниши</option>
            {stats.allNiches.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
            <option value="none">Без ниши</option>
          </select>

          {/* Фильтр по внедрению */}
          <select
            value={adoptionFilter}
            onChange={(e) => setAdoptionFilter(e.target.value)}
            className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
          >
            <option value="all">Любое внедрение</option>
            <option value="low">Требуют внимания (&lt;40%)</option>
            <option value="high">Успешно внедрены (&gt;=80%)</option>
          </select>
        </div>

        {/* Таблица компаний */}
        {isLoading ? (
          <SkeletonTable rows={8} />
        ) : isError ? (
          <div className="rounded-[8px] border border-rose-200 bg-rose-50 p-6">
            <p className="text-sm font-medium text-rose-700">
              Не удалось загрузить список компаний: {error?.message}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-3 rounded-[8px] border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
            >
              Повторить
            </button>
          </div>
        ) : filteredTenants.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={tenants.length === 0 ? "Компаний пока нет" : "Ничего не найдено"}
            description={
              tenants.length === 0
                ? "Как только клиенты зарегистрируются, они появятся в этом списке."
                : "Попробуйте сбросить фильтры или изменить поисковый запрос."
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa] uppercase tracking-wider text-[#666666]">
                  <th className="px-3.5 py-2.5 font-medium min-w-[220px]">Компания и Ниша</th>
                  <th className="px-3 py-2.5 font-medium min-w-[130px]">Тариф / Цена</th>
                  <th className="px-3 py-2.5 font-medium">Статус</th>
                  <th className="px-3 py-2.5 font-medium min-w-[140px]">Внедрение (Adoption)</th>
                  <th className="px-3 py-2.5 font-medium min-w-[130px]">AI-Боты и Баланс</th>
                  <th className="px-3 py-2.5 font-medium min-w-[100px]">Подписка до</th>
                  <th className="px-3.5 py-2.5 text-right font-medium min-w-[200px]">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5e5e5]">
                {hierarchicalTenants.map((item) => {
                  const tenant = item.tenant;
                  const isRootPartner = item.isPartner && tenant.slug !== "voxly";
                  const isPlatformRoot = tenant.slug === "voxly" || tenant.id === "c0000000-0000-0000-0000-000000000001";
                  const isSubClient = item.isSubClient;
                  const hasCustomPrice = tenant.custom_price_rubles !== null;
                  const isFree = tenant.custom_price_rubles === 0;

                  return (
                    <tr
                      key={tenant.id}
                      className={cn(
                        "transition-colors",
                        isRootPartner
                          ? "bg-[#fafbff]/80 hover:bg-[#f0f4ff]/70 border-l-3 border-l-[#4a38f5]"
                          : isSubClient
                            ? "bg-[#fafafa]/50 hover:bg-[#fafafa]"
                            : "hover:bg-[#fafafa]",
                      )}
                    >
                      {/* Компания, ниша, контакты владельца */}
                      <td className="px-3.5 py-2.5">
                        {isRootPartner ? (
                          <div className="flex items-start gap-2.5">
                            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-indigo-200 bg-indigo-50 text-indigo-700">
                              <Briefcase className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-semibold text-sm text-[#111111]">{tenant.name}</span>
                                <span className="inline-flex items-center gap-1 rounded-[4px] border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                                  <Briefcase className="h-2.5 w-2.5" />
                                  Партнёр платформы
                                </span>
                                {item.childCount !== undefined && item.childCount > 0 && (
                                  <span className="inline-flex items-center gap-1 rounded-[4px] border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-700 shadow-2xs">
                                    <Users className="h-2.5 w-2.5 text-slate-500" />
                                    {item.childCount} {item.childCount === 1 ? "клиент" : item.childCount < 5 ? "клиента" : "клиентов"}
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#666666]">
                                {tenant.slug && (
                                  <span className="font-mono text-[#888888]">
                                    {tenant.slug}.getvoxly.ru
                                  </span>
                                )}
                                {tenant.business_niche && (
                                  <span className="inline-flex items-center rounded-[4px] bg-[#4a38f5]/10 px-1.5 py-0.2 text-[10px] font-medium text-[#4a38f5]">
                                    {tenant.business_niche}
                                  </span>
                                )}
                              </div>
                              {(tenant.owner_email || tenant.owner_name) && (
                                <div className="mt-1 flex items-center gap-2 text-[11px] text-[#666666]">
                                  {tenant.owner_name && <span>{tenant.owner_name}</span>}
                                  {tenant.owner_email && (
                                    <span className="text-[#888888]">({tenant.owner_email})</span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : isSubClient ? (
                          <div className="pl-6 flex items-start gap-2">
                            <div className="pt-0.5 shrink-0 text-[#888888]">
                              <CornerDownRight className="h-4 w-4 text-[#888888]" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-semibold text-xs text-[#111111]">{tenant.name}</span>
                                {tenant.slug && (
                                  <span className="font-mono text-[11px] text-[#888888]">
                                    @{tenant.slug}
                                  </span>
                                )}
                                <span className="inline-flex items-center gap-1 rounded-[4px] border border-slate-200 bg-white px-1.5 py-0.2 text-[10px] font-medium text-slate-700 shadow-2xs">
                                  Клиент партнёра {item.parentPartnerName || "ЭЛЕРОН"}
                                </span>
                              </div>
                              <div className="mt-0.5 flex items-center gap-1.5">
                                {tenant.business_niche ? (
                                  <span className="inline-flex items-center rounded-[4px] bg-[#4a38f5]/10 px-1.5 py-0.2 text-[10px] font-medium text-[#4a38f5]">
                                    {tenant.business_niche}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setManagingTenant(tenant)}
                                    className="text-[10px] text-[#888888] underline underline-offset-2 hover:text-[#111111]"
                                  >
                                    + указать нишу
                                  </button>
                                )}
                                {tenant.custom_notes && (
                                  <span
                                    title={`Заметка: ${tenant.custom_notes}`}
                                    className="cursor-help rounded-[4px] border border-[#fef08a] bg-[#fefce8] px-1 py-0.2 text-[10px] text-[#854d0e]"
                                  >
                                    заметка
                                  </span>
                                )}
                              </div>
                              {(tenant.owner_email || tenant.owner_name) && (
                                <div className="mt-1 flex items-center gap-2 text-[11px] text-[#666666]">
                                  {tenant.owner_name && <span>{tenant.owner_name}</span>}
                                  {tenant.owner_email && (
                                    <span className="text-[#888888]">({tenant.owner_email})</span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="flex items-start justify-between gap-1">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-[#111111]">{tenant.name}</span>
                                {isPlatformRoot ? (
                                  <span className="inline-flex items-center rounded-[4px] border border-sky-200 bg-sky-50 px-1.5 py-0.2 text-[10px] font-semibold text-sky-700">
                                    Платформа (Root)
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center rounded-[4px] border border-[#e5e5e5] bg-[#fafafa] px-1.5 py-0.2 text-[10px] text-[#666666]">
                                    Клиент
                                  </span>
                                )}
                              </div>
                              {tenant.slug && (
                                <span className="font-mono text-[11px] text-[#888888]">
                                  {tenant.slug}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex items-center gap-1.5">
                              {tenant.business_niche ? (
                                <span className="inline-flex items-center rounded-[4px] bg-[#4a38f5]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#4a38f5]">
                                  {tenant.business_niche}
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setManagingTenant(tenant)}
                                  className="text-[10px] text-[#888888] underline underline-offset-2 hover:text-[#111111]"
                                >
                                  + указать нишу
                                </button>
                              )}
                              {tenant.custom_notes && (
                                <span
                                  title={`Заметка: ${tenant.custom_notes}`}
                                  className="cursor-help rounded-[4px] border border-[#fef08a] bg-[#fefce8] px-1 py-0.2 text-[10px] text-[#854d0e]"
                                >
                                  заметка
                                </span>
                              )}
                            </div>
                            {(tenant.owner_email || tenant.owner_name) && (
                              <div className="mt-1 flex items-center gap-2 text-[11px] text-[#666666]">
                                {tenant.owner_name && <span>{tenant.owner_name}</span>}
                                {tenant.owner_email && (
                                  <span className="text-[#888888]">({tenant.owner_email})</span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Тариф и Цена */}
                      <td className="px-3 py-2.5">
                        {isRootPartner ? (
                          <div>
                            <span className="inline-flex items-center rounded-[4px] border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                              {tenant.custom_plan_name || "Партнёрский тариф"}
                            </span>
                            <p className="mt-0.5 font-mono text-xs font-semibold text-[#111111]">
                              0 ₽ (Партнёр)
                            </p>
                            <span className="text-[10px] text-[#888888]">Партнёрский доступ</span>
                          </div>
                        ) : isFree ? (
                          <div>
                            <span className="inline-flex items-center rounded-[4px] border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                              {tenant.custom_plan_name || "Бесплатный (Клиент)"}
                            </span>
                            <p className="mt-0.5 font-mono text-xs font-semibold text-[#111111]">
                              0 ₽ (Бесплатно)
                            </p>
                            <span className="text-[10px] text-[#888888]">
                              {isSubClient ? "Субклиент партнёра" : "Клиентский тариф"}
                            </span>
                          </div>
                        ) : hasCustomPrice || tenant.custom_plan_name ? (
                          <div>
                            <span className="inline-flex items-center rounded-[4px] border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                              {tenant.custom_plan_name || "Индивидуальный"}
                            </span>
                            <p className="mt-0.5 font-mono text-xs font-semibold text-[#111111]">
                              {tenant.custom_price_rubles?.toLocaleString("ru-RU")} ₽/мес
                            </p>
                            <span className="text-[10px] text-[#888888]">Спецтариф</span>
                          </div>
                        ) : (
                          <div>
                            <span className="capitalize font-medium text-[#111111]">
                              {tenant.plan}
                            </span>
                            <p className="text-[11px] text-[#888888]">Стандартный</p>
                          </div>
                        )}
                      </td>

                      {/* Статус */}
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                            STATUS_STYLES[tenant.status] ?? STATUS_STYLES.suspended,
                          )}
                        >
                          {STATUS_LABEL[tenant.status] ?? tenant.status}
                        </span>
                      </td>

                      {/* Внедрение (Adoption Score) */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#e5e5e5]">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                tenant.adoption_score >= 80
                                  ? "bg-emerald-500"
                                  : tenant.adoption_score >= 40
                                    ? "bg-amber-500"
                                    : "bg-rose-500",
                              )}
                              style={{ width: `${Math.max(5, tenant.adoption_score)}%` }}
                            />
                          </div>
                          <span
                            className={cn(
                              "font-mono font-semibold text-xs",
                              tenant.adoption_score >= 80
                                ? "text-emerald-700"
                                : tenant.adoption_score >= 40
                                  ? "text-amber-700"
                                  : "text-rose-600",
                            )}
                          >
                            {tenant.adoption_score}%
                          </span>
                        </div>

                        {/* Чеклист иконок */}
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[#666666]">
                          <span
                            title={tenant.adoption_checklist?.has_channels ? "Каналы подключены" : "Каналы не подключены"}
                            className={tenant.adoption_checklist?.has_channels ? "text-emerald-600 font-bold" : "text-[#cccccc]"}
                          >
                            TG/WA
                          </span>
                          <span>•</span>
                          <span
                            title={tenant.adoption_checklist?.has_deals ? "Сделки ведутся" : "Нет сделок CRM"}
                            className={tenant.adoption_checklist?.has_deals ? "text-emerald-600 font-bold" : "text-[#cccccc]"}
                          >
                            CRM
                          </span>
                          <span>•</span>
                          <span
                            title={tenant.adoption_checklist?.has_ai ? "AI-боты настроены" : "AI-боты не настроены"}
                            className={tenant.adoption_checklist?.has_ai ? "text-emerald-600 font-bold" : "text-[#cccccc]"}
                          >
                            AI
                          </span>
                          <span>•</span>
                          <span
                            title={tenant.adoption_checklist?.has_knowledge ? "База знаний заполнена" : "База знаний пуста"}
                            className={tenant.adoption_checklist?.has_knowledge ? "text-emerald-600 font-bold" : "text-[#cccccc]"}
                          >
                            БЗ
                          </span>
                        </div>
                      </td>

                      {/* AI Боты и Баланс */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <Bot
                            className={cn(
                              "h-3.5 w-3.5",
                              tenant.ai_status === "active"
                                ? "text-emerald-600"
                                : tenant.ai_status === "paused"
                                  ? "text-amber-600"
                                  : "text-[#aaaaaa]",
                            )}
                          />
                          <span className="text-[11px] font-medium text-[#111111]">
                            {tenant.ai_status === "active"
                              ? `${tenant.ai_active_agents_count} акт.`
                              : tenant.ai_status === "paused"
                                ? "Пауза"
                                : "Не настроен"}
                          </span>
                        </div>
                        <p className="mt-0.5 font-mono text-[11px] text-[#666666]">
                          Баланс: {formatRubles(tenant.ai_balance_kopecks)}
                        </p>
                      </td>

                      {/* Подписка до */}
                      <td className="px-3 py-2.5 text-[#666666]">
                        {formatDate(tenant.subscription_expires_at)}
                      </td>

                      {/* Действия */}
                      <td className="px-3.5 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Войти как клиент (Impersonation) */}
                          <button
                            type="button"
                            onClick={() => void handleImpersonate(tenant)}
                            disabled={pendingId === tenant.id}
                            title="Войти в CRM под аккаунтом компании"
                            className="flex h-7 items-center gap-1 rounded-[6px] border border-[#4a38f5] bg-[#4a38f5] px-2 text-[11px] font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50"
                          >
                            {pendingId === tenant.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <LogIn className="h-3 w-3" />
                            )}
                            <span>Войти</span>
                          </button>

                          {/* Настроить (тариф, ниша, баланс) */}
                          <button
                            type="button"
                            onClick={() => setManagingTenant(tenant)}
                            title="Настроить индивидуальный тариф, нишу и баланс"
                            className="flex h-7 items-center gap-1 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-[11px] font-medium text-[#111111] transition-colors hover:bg-[#fafafa]"
                          >
                            <Settings className="h-3 w-3 text-[#666666]" />
                            <span>Настроить</span>
                          </button>

                          {/* +30 дней */}
                          <button
                            type="button"
                            onClick={() => void handleRenew(tenant)}
                            disabled={pendingId === tenant.id}
                            title="Продлить подписку на 30 дней"
                            className="h-7 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-[11px] font-medium text-[#111111] transition-colors hover:bg-[#fafafa] disabled:opacity-50"
                          >
                            +30 дн
                          </button>

                          {/* Пауза / Включить */}
                          <button
                            type="button"
                            onClick={() => void handleToggleStatus(tenant)}
                            disabled={pendingId === tenant.id}
                            title={tenant.status === "suspended" ? "Активировать компанию" : "Приостановить доступ"}
                            className={cn(
                              "h-7 rounded-[6px] px-2 text-[11px] font-medium transition-colors disabled:opacity-50",
                              tenant.status === "suspended"
                                ? "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                : "border border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#fafafa]",
                            )}
                          >
                            {tenant.status === "suspended" ? "Вкл" : "Пауза"}
                          </button>

                          {/* Удалить */}
                          {tenant.slug !== "voxly" && tenant.slug !== "platform" && (
                            <button
                              type="button"
                              onClick={() => setDeletingTenant(tenant)}
                              disabled={pendingId === tenant.id}
                              title="Полное удаление компании"
                              className="flex h-7 items-center rounded-[6px] border border-rose-200 bg-rose-50 p-1.5 text-rose-600 transition-colors hover:bg-rose-100 disabled:opacity-50"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Модальное окно управления тарифом, нишей и балансом */}
        <TenantManageModal
          open={managingTenant !== null}
          tenant={managingTenant}
          allTenants={tenants}
          onClose={() => setManagingTenant(null)}
          onSaved={() => void refetch()}
        />

        {/* Диалог удаления компании */}
        <DeleteTenantDialog
          tenant={deletingTenant}
          open={deletingTenant !== null}
          onClose={() => setDeletingTenant(null)}
          onDeleted={() => void refetch()}
        />
      </div>
    </PlatformOwnerGuard>
  );
}
