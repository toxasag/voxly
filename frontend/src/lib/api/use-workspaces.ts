"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiClient, type ApiClientError } from "@/lib/api/apiClient";
import { readAccessToken, readRefreshToken, writeTokens } from "@/lib/auth/session";
import {
  readImpersonationBackup,
  writeImpersonationBackup,
  clearImpersonationBackup,
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
): Promise<void> {
  const normTarget = targetSlug.trim().toLowerCase();
  const normCurrent = currentSlug.trim().toLowerCase();

  if (normTarget === normCurrent) return;

  const currentAccessToken = readAccessToken();
  const currentRefreshToken = readRefreshToken();
  const existingBackup = readImpersonationBackup();

  // Если возвращаемся назад в родительскую платформу (например, voxly) и у нас есть исходная сессия админа:
  if (normTarget === "voxly" && existingBackup) {
    writeTokens({
      accessToken: existingBackup.accessToken,
      refreshToken: existingBackup.refreshToken || existingBackup.accessToken,
    });
    const targetUrl = tenantPortalUrl(normTarget, "/crm/contacts");
    const redirectUrl = targetUrl.includes("://")
      ? `${targetUrl}#restore_token=${encodeURIComponent(existingBackup.accessToken)}`
      : targetUrl;
    window.location.href = redirectUrl;
    return;
  }

  // При входе в дочернее пространство сохраняем текущую сессию в бэкап
  if (currentAccessToken && !existingBackup) {
    writeImpersonationBackup({
      accessToken: currentAccessToken,
      refreshToken: currentRefreshToken || currentAccessToken,
      adminUserEmail: userEmail ?? "",
      adminUserName: userName ?? "",
      adminOriginHost: typeof window !== "undefined" ? window.location.host : "",
      impersonatedTenantSlug: normTarget,
      enteredAt: new Date().toISOString(),
    });
  }

  // Выпускаем токены для целевого пространства
  const res = await apiClient.post<AuthTokensDTO>(
    `/api/v1/admin/tenants/by-slug/${normTarget}/impersonate`,
  );

  if (res.data) {
    const { access_token, refresh_token } = res.data;
    if (access_token && refresh_token) {
      writeTokens({ accessToken: access_token, refreshToken: refresh_token });
    }
    const targetUrl = tenantPortalUrl(normTarget, "/crm/contacts");
    const redirectUrl =
      targetUrl.includes("://") && access_token
        ? `${targetUrl}#tenant_token=${encodeURIComponent(access_token)}`
        : targetUrl;
    window.location.href = redirectUrl;
  }
}
