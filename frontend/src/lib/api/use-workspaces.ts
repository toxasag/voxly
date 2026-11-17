"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiClient, type ApiClientError } from "@/lib/api/apiClient";
import { readAccessToken, readRefreshToken, writeTokens } from "@/lib/auth/session";
import {
  readImpersonationBackup,
  writeImpersonationBackup,
  clearImpersonationBackup,
  restoreAdminSessionDetailed,
} from "@/lib/auth/impersonation";
import { tenantPortalUrl } from "@/lib/auth/tenant-host";
import type { AuthTokensDTO } from "@/lib/auth/use-auth";

export interface WorkspaceDTO {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  is_current: boolean;
  is_parent: boolean;
  role: string;
  is_partner?: boolean;
}

export const workspaceKeys = {
  all: ["workspaces"] as const,
  list: () => [...workspaceKeys.all, "list"] as const,
};

/**
 * Запрос списка доступных рабочих пространств организации.
 */
export function useWorkspaces(): UseQueryResult<WorkspaceDTO[], ApiClientError> {
  return useQuery({
    queryKey: workspaceKeys.list(),
    queryFn: async () => {
      const res = await apiClient.get<WorkspaceDTO[]>("/api/v1/tenant/workspaces");
      return res.data;
    },
    staleTime: 60_000,
  });
}

/**
 * Бесшовное переключение на другое рабочее пространство (организацию).
 */
export async function switchWorkspace(
  targetSlug: string,
  currentSlug: string,
  userEmail?: string,
  userName?: string,
  isPartner?: boolean,
  isPlatformOwner?: boolean,
  isTargetParent?: boolean,
): Promise<void> {
  const normTarget = targetSlug.trim().toLowerCase();
  const normCurrent = currentSlug.trim().toLowerCase();

  if (normTarget === normCurrent) return;

  const currentAccessToken = readAccessToken();
  const currentRefreshToken = readRefreshToken();
  const existingBackup = readImpersonationBackup();

  const originPrefix = existingBackup?.adminOriginHost?.split(".")[0]?.split(":")[0]?.toLowerCase();

  // Если цель - родительское пространство или исходный кабинет администратора/партнера
  if (
    isTargetParent ||
    (existingBackup && (normTarget === "voxly" || (originPrefix && normTarget === originPrefix)))
  ) {
    if (existingBackup) {
      try {
        const res = await restoreAdminSessionDetailed();
        if (res.success && res.targetUrl) {
          window.location.href = res.targetUrl;
          return;
        }
      } catch (err) {
        console.warn("restoreAdminSessionDetailed не удался, пробуем альтернативный возврат:", err);
      }
    }

    try {
      const revertRes = await apiClient.post<AuthTokensDTO>("/api/v1/partner/revert-tenant", {
        admin_refresh_token: existingBackup?.refreshToken,
        admin_access_token: existingBackup?.accessToken,
      });
      if (revertRes.data?.access_token) {
        writeTokens({
          accessToken: revertRes.data.access_token,
          refreshToken: revertRes.data.refresh_token || revertRes.data.access_token,
        });
        clearImpersonationBackup();
        const targetUrl = tenantPortalUrl(normTarget, "/partner");
        window.location.href = targetUrl;
        return;
      }
    } catch {
      // Игнорируем и пробуем следующий шаг
    }

    try {
      const res = await apiClient.post<AuthTokensDTO>(`/api/v1/auth/impersonate`, { slug: normTarget });
      if (res.data?.access_token) {
        writeTokens({
          accessToken: res.data.access_token,
          refreshToken: res.data.refresh_token || res.data.access_token,
        });
        clearImpersonationBackup();
        const targetUrl = tenantPortalUrl(normTarget, "/partner");
        window.location.href = targetUrl;
        return;
      }
    } catch {
      // Игнорируем и переходим к прямому переходу
    }

    // Если всё остальное не вернуло токен, совершаем прямой переход на домен родителя
    const targetUrl = tenantPortalUrl(normTarget, "/partner");
    window.location.href = targetUrl;
    return;
  }

  // При входе в дочернее пространство сохраняем текущую сессию в бэкап
  let activeBackup = existingBackup;
  if (currentAccessToken && !activeBackup) {
    activeBackup = {
      accessToken: currentAccessToken,
      refreshToken: currentRefreshToken || currentAccessToken,
      adminUserEmail: userEmail ?? "",
      adminUserName: userName ?? "",
      adminOriginHost: typeof window !== "undefined" ? window.location.host : "",
      adminOriginPath: typeof window !== "undefined" ? window.location.pathname : "/partner",
      isPartner: isPartner ?? false,
      isPlatformOwner: isPlatformOwner ?? false,
      impersonatedTenantSlug: normTarget,
      enteredAt: new Date().toISOString(),
    };
    writeImpersonationBackup(activeBackup);
  }

  // Выпускаем токены для целевого пространства
  const res = await apiClient.post<AuthTokensDTO>(
    `/api/v1/auth/impersonate`,
    { slug: normTarget },
  );

  if (res.data) {
    const { access_token, refresh_token } = res.data;
    if (access_token && refresh_token) {
      writeTokens({ accessToken: access_token, refreshToken: refresh_token });
    }
    const targetUrl = tenantPortalUrl(normTarget, "/crm/contacts");
    const hashParams = new URLSearchParams();
    if (access_token) hashParams.set("tenant_token", access_token);
    if (activeBackup) hashParams.set("impersonator_backup", JSON.stringify(activeBackup));

    const redirectUrl = targetUrl.includes("://")
      ? `${targetUrl}#${hashParams.toString()}`
      : targetUrl;
    window.location.href = redirectUrl;
  }
}
