"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiClient, type ApiClientError } from "@/lib/api/apiClient";
import type { Role } from "@/types";

// Mirrors backend/src/modules/tenant/tenant.service.ts TenantUserDTO.
export interface TenantUserDTO {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  avatarUrl: string | null;
}

export const tenantUserKeys = { all: ["tenant", "users"] as const };

/**
 * Catalog of the current tenant's users, for assignee/manager pickers and for
 * resolving a user id to a name + avatar in cards. Cached longer than list data
 * since membership changes rarely.
 */
export function useTenantUsers(): UseQueryResult<TenantUserDTO[], ApiClientError> {
  return useQuery({
    queryKey: tenantUserKeys.all,
    queryFn: async () => (await apiClient.get<TenantUserDTO[]>("/api/v1/tenant/users")).data,
    staleTime: 5 * 60_000,
  });
}

/** Deterministic initials for the avatar fallback. */
export function userInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0]?.charAt(0) ?? "?").toUpperCase();
  return `${parts[0]?.charAt(0) ?? ""}${parts[parts.length - 1]?.charAt(0) ?? ""}`.toUpperCase();
}

/** Builds an id → user lookup for O(1) resolution in list rows. */
export function indexTenantUsers(users: TenantUserDTO[] | undefined): Map<string, TenantUserDTO> {
  const map = new Map<string, TenantUserDTO>();
  for (const user of users ?? []) map.set(user.id, user);
  return map;
}
