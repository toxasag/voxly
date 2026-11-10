"use client";

import { useState } from "react";
import {
  Building2,
  Plus,
  ExternalLink,
  LogIn,
  Users,
  ShieldCheck,
  Search,
  CheckCircle2,
  Lock,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/lib/auth/use-auth";
import { usePartnerChildTenants, type PartnerChildTenantDTO } from "@/lib/api/use-partner";
import { CreateTenantDialog } from "@/components/partner/CreateTenantDialog";
import { writeImpersonationBackup, type ImpersonationBackup } from "@/lib/auth/impersonation";
import { readAccessToken, readRefreshToken, writeTokens } from "@/lib/auth/session";
import { apiClient } from "@/lib/api/apiClient";
import { tenantPortalUrl } from "@/lib/auth/tenant-host";
import type { AuthTokensDTO } from "@/lib/auth/use-auth";
import { toast } from "sonner";

export default function PartnerPage() {
  const { user, tenant } = useAuth();
  const [search, setSearch] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);

  const { data: childTenants, isLoading, error } = usePartnerChildTenants();

  const isPlatformOwner = user?.platform_role === "platform_owner";
  const isPartner =
    isPlatformOwner ||
    user?.is_partner === true ||
    tenant?.is_partner === true ||
    user?.role === "partner";

  const handleEnterPortal = async (child: PartnerChildTenantDTO) => {
    try {
      setImpersonatingId(child.id);
      const currentAccessToken = readAccessToken();
      const currentRefreshToken = readRefreshToken();

      let backupData: ImpersonationBackup | null = null;
      if (currentAccessToken) {
        backupData = {
          accessToken: currentAccessToken,
          refreshToken: currentRefreshToken || currentAccessToken,
          adminUserEmail: user?.email ?? "",
          adminUserName: user?.name ?? "",
          adminOriginHost: typeof window !== "undefined" ? window.location.host : "",
          adminOriginPath: "/partner",
          isPartner: true,
          isPlatformOwner,
          impersonatedTenantSlug: child.slug,
          impersonatedTenantName: child.name,
          impersonatedUserEmail: child.admin?.email ?? undefined,
          enteredAt: new Date().toISOString(),
        };
        writeImpersonationBackup(backupData);
      }

      const res = await apiClient.post<AuthTokensDTO>("/api/v1/auth/impersonate", {
        slug: child.slug,
      });

      if (res.data) {
        const { access_token, refresh_token } = res.data;
        if (access_token && refresh_token) {
          writeTokens({ accessToken: access_token, refreshToken: refresh_token });
        }
        const targetUrl = tenantPortalUrl(child.slug, "/dashboard");
        const hashParams = new URLSearchParams();
        if (access_token) hashParams.set("tenant_token", access_token);
        if (backupData) hashParams.set("impersonator_backup", JSON.stringify(backupData));

        const redirectUrl = targetUrl.includes("://")
          ? `${targetUrl}#${hashParams.toString()}`
          : targetUrl;
        window.location.href = redirectUrl;
      }
    } catch (err) {
      console.error("Ошибка входа в портал клиента:", err);
      toast.error(err instanceof Error ? err.message : "Не удалось войти в портал клиента");
      setImpersonatingId(null);
    }
  };

  // Экран блокировки для пользователей без партнерских прав
  if (!isPartner) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center p-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fafafa] border border-[#e5e5e5] text-[#888888] shadow-2xs">
          <Lock className="h-7 w-7 text-[#888888]" />
        </div>
        <h1 className="mt-4 text-base font-semibold text-[#111111]">
          Раздел доступен только партнёрам платформы
        </h1>
        <p className="mt-2 max-w-md text-xs text-[#666666] leading-relaxed">
          В партнерском кабинете можно создавать изолированные рабочие пространства для своих
          клиентов, управлять тарифами и бесшовно переключаться между ними.
        </p>
      </div>
    );
  }

  const list = childTenants ?? [];
  const filteredList = list.filter((item) => {
    if (!search.trim()) return true;
    const query = search.toLowerCase();
    return (
      item.name.toLowerCase().includes(query) ||
      item.slug.toLowerCase().includes(query) ||
      (item.admin?.email || "").toLowerCase().includes(query) ||
      (item.admin?.name || "").toLowerCase().includes(query)
    );
  });

  const totalClients = list.length;
  const activeClients = list.filter((t) => t.status === "active").length;
  const totalUsers = list.reduce((acc, t) => acc + (t.users_count || 1), 0);

  return (
    <div className="min-h-screen bg-white">
      {/* Шапка раздела */}
      <div className="border-b border-[#e5e5e5] bg-white px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-[#111111]">
                {tenant?.tenantName ? `Кабинет партнёра: ${tenant.tenantName}` : "Кабинет партнёра"}
              </h1>
              <span className="rounded-[4px] border border-[#e5e5e5] bg-[#fafafa] px-2 py-0.5 text-[11px] font-medium text-[#666666]">
                {tenant?.slug ? `${tenant.slug}.getvoxly.ru` : "Партнёрская программа"}
              </span>
            </div>
            <p className="mt-1 text-xs text-[#666666]">
              Управление клиентскими порталами, учетными записями и бесшовный вход в пространства
            </p>
          </div>

          <button
            type="button"
            onClick={() => setCreateDialogOpen(true)}
            className="flex items-center gap-2 rounded-[8px] bg-[#4a38f5] px-3.5 py-2 text-[13px] font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Создать портал клиента</span>
          </button>
        </div>

        {/* Метрики */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
            <span className="text-[11px] font-medium text-[#666666] uppercase tracking-wider">
              Всего порталов
            </span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-xl font-bold text-[#111111] tabular-nums">
                {totalClients}
              </span>
              <span className="text-xs text-[#888888]">клиентов в пуле</span>
            </div>
          </div>

          <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
            <span className="text-[11px] font-medium text-[#666666] uppercase tracking-wider">
              Активных пространств
            </span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-xl font-bold text-emerald-600 tabular-nums">
                {activeClients}
              </span>
              <span className="text-xs text-[#888888]">готовы к работе</span>
            </div>
          </div>

          <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
            <span className="text-[11px] font-medium text-[#666666] uppercase tracking-wider">
              Пользователей клиентов
            </span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-xl font-bold text-[#111111] tabular-nums">
                {totalUsers}
              </span>
              <span className="text-xs text-[#888888]">сотрудников</span>
            </div>
          </div>
        </div>
      </div>

      {/* Основная таблица / список */}
      <div className="p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#888888]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по названию, поддомену или e-mail..."
              className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white pl-8 pr-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
          </div>
          <span className="text-xs text-[#888888]">
            Найдено: <strong className="text-[#111111]">{filteredList.length}</strong>
          </span>
        </div>

        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[#4a38f5]" />
          </div>
        ) : error ? (
          <div className="rounded-[8px] border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
            Не удалось загрузить список клиентских порталов
          </div>
        ) : filteredList.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-[#e5e5e5] bg-[#fafafa] p-10 text-center">
            <Building2 className="mx-auto h-8 w-8 text-[#888888]" />
            <h3 className="mt-3 text-[13px] font-semibold text-[#111111]">
              {search ? "Порталы не найдены" : "У вас пока нет созданных клиентских порталов"}
            </h3>
            <p className="mt-1 text-xs text-[#666666]">
              {search
                ? "Попробуйте изменить поисковый запрос"
                : "Нажмите «Создать портал клиента», чтобы развернуть новое рабочее пространство"}
            </p>
            {!search && (
              <button
                type="button"
                onClick={() => setCreateDialogOpen(true)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 py-1.5 text-xs font-medium text-white shadow-xs hover:bg-[#3d2ee0]"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Создать первый портал</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
                    <th className="px-4 py-2.5">Компания</th>
                    <th className="px-4 py-2.5">Администратор</th>
                    <th className="px-4 py-2.5">Тариф</th>
                    <th className="px-4 py-2.5">Статус</th>
                    <th className="px-4 py-2.5">Создан</th>
                    <th className="px-4 py-2.5 text-right">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0f0f0] text-[13px]">
                  {filteredList.map((client) => {
                    const isEntering = impersonatingId === client.id;
                    return (
                      <tr
                        key={client.id}
                        className="transition-colors hover:bg-black/[0.02]"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-black/[0.06] text-xs font-semibold text-[#111111]">
                              {client.name.charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <span className="block font-medium text-[#111111] truncate">
                                {client.name}
                              </span>
                              <a
                                href={`https://${client.slug}.getvoxly.ru`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 font-mono text-[11px] text-[#4a38f5] hover:underline"
                              >
                                {client.slug}.getvoxly.ru
                                <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-3">
                          <div className="text-xs">
                            <span className="block font-medium text-[#111111]">
                              {client.admin?.name || "Администратор"}
                            </span>
                            <span className="block text-[#666666] font-mono text-[11px]">
                              {client.admin?.email || "—"}
                            </span>
                          </div>
                        </td>

                        <td className="px-4 py-3">
                          <span className="inline-block rounded-[4px] border border-[#e5e5e5] bg-[#fafafa] px-2 py-0.5 text-xs font-medium text-[#111111] uppercase">
                            {client.plan}
                          </span>
                        </td>

                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1 rounded-[4px] border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" />
                            {client.status === "active" ? "Активен" : client.status}
                          </span>
                        </td>

                        <td className="px-4 py-3 text-xs text-[#666666] font-mono">
                          {new Date(client.created_at).toLocaleDateString("ru-RU")}
                        </td>

                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            disabled={isEntering}
                            onClick={() => handleEnterPortal(client)}
                            className="inline-flex items-center gap-1.5 rounded-[6px] bg-[#111111] px-2.5 py-1 text-xs font-medium text-white shadow-2xs hover:bg-[#333333] transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            {isEntering ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <LogIn className="h-3 w-3" />
                            )}
                            <span>{isEntering ? "Вход..." : "Войти в портал"}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <CreateTenantDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
      />
    </div>
  );
}
