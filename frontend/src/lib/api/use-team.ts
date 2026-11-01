"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiClient, type ApiClientError } from "@/lib/api/apiClient";
import { tenantUserKeys } from "@/lib/api/use-tenant-users";
import { marketplaceKeys } from "@/lib/api/use-marketplace";
import type { Permission, Role } from "@/types";

// Зеркалит backend/src/modules/tenant/team.service.ts.

export type TeamMemberStatus = "active" | "invited";

export interface TeamMemberDTO {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: Role;
  permissions: Permission[];
  status: TeamMemberStatus;
  /** Base64 data-URI либо null; при null интерфейс показывает инициалы. */
  isOwner: boolean;
  isSelf: boolean;
  invitedAt: string | null;
  activatedAt: string | null;
  createdAt: string;
}

export interface SeatUsageDTO {
  used: number;
  included: number;
  extra: number;
  extraSeatPrice: number;
  nextSeatPrice: number;
}

/**
 * Роль, которую можно назначить сотруднику.
 *
 * `owner` исключён на уровне типа, а не только проверкой: владелец создаётся
 * при регистрации арендатора, и второй владелец через приглашение означал бы
 * неограниченную передачу прав на биллинг. Совпадает с `ASSIGNABLE_ROLES` и
 * Zod-схемой бэкенда.
 */
export type AssignableRole = Exclude<Role, "owner" | "partner">;

export interface TeamListDTO {
  members: TeamMemberDTO[];
  seats: SeatUsageDTO;
  assignableRoles: AssignableRole[];
  availablePermissions: Permission[];
}

export interface TenantInfoDTO {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  trialEndsAt: string | null;
  /** Считается на сервере: браузерные часы можно перевести. */
  trialDaysLeft: number;
  trialActive: boolean;
  createdAt: string | null;
  customPriceRubles?: number | null;
  customPlanName?: string | null;
  isCustomPlan?: boolean;
  isFreeCustomPlan?: boolean;
  isPartner?: boolean;
}

export const teamKeys = {
  list: ["tenant", "team"] as const,
  info: ["tenant", "info"] as const,
};

/** Русские названия ролей. Совпадают с ROLE_LABELS на бэкенде. */
export const ROLE_LABELS: Record<Role, string> = {
  owner: "Владелец",
  admin: "Администратор",
  partner: "Партнёр",
  manager: "Менеджер",
  technician: "Мастер",
  viewer: "Наблюдатель",
};

/** Что роль даёт — показывается при выборе, иначе выбор вслепую. */
export const ROLE_HINTS: Record<Role, string> = {
  owner: "Полный доступ, включая подписку и оплату",
  admin: "Всё, кроме управления подпиской и оплатой",
  partner: "Управление клиентскими порталами и компаниями",
  manager: "Работа с клиентами, сделками и задачами",
  technician: "Приёмка и выполнение ремонтов, задачи",
  viewer: "Только просмотр данных",
};

export function useTeam(): UseQueryResult<TeamListDTO, ApiClientError> {
  return useQuery({
    queryKey: teamKeys.list,
    queryFn: async () => (await apiClient.get<TeamListDTO>("/api/v1/tenant/team")).data,
  });
}

/** План, статус и остаток пробного периода аккаунта. */
export function useTenantInfo(): UseQueryResult<TenantInfoDTO, ApiClientError> {
  return useQuery({
    queryKey: teamKeys.info,
    queryFn: async () => (await apiClient.get<TenantInfoDTO>("/api/v1/tenant/info")).data,
    staleTime: 5 * 60_000,
  });
}

export interface InviteResultDTO {
  member: TeamMemberDTO;
  seats: SeatUsageDTO;
  emailSent: boolean;
  /** Одноразовая ссылка только когда SMTP не доставил письмо. */
  inviteUrl: string | null;
}

export interface InvitePayload {
  name: string;
  email: string;
  role: AssignableRole;
  /** Согласие на платное место сверх включённых. */
  confirm_extra_seat?: boolean;
}

/**
 * Инвалидация затрагивает и биллинг: число пользователей входит в тариф
 * per_seat базовой CRM, поэтому сумма меняется вместе с составом команды. Без
 * этого счёт на соседней странице остался бы прежним.
 */
function useTeamMutationInvalidation(): () => void {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: teamKeys.list });
    void queryClient.invalidateQueries({ queryKey: tenantUserKeys.all });
    void queryClient.invalidateQueries({ queryKey: marketplaceKeys.billing });
    void queryClient.invalidateQueries({ queryKey: marketplaceKeys.modules });
  };
}

export function useInviteMember(): UseMutationResult<InviteResultDTO, ApiClientError, InvitePayload> {
  const invalidate = useTeamMutationInvalidation();

  return useMutation<InviteResultDTO, ApiClientError, InvitePayload>({
    mutationFn: async (payload) =>
      (await apiClient.post<InviteResultDTO>("/api/v1/tenant/team/invite", payload)).data,
  });
}

export function useChangeMemberRole(): UseMutationResult<
  TeamMemberDTO,
  ApiClientError,
  { id: string; role: AssignableRole; permissions?: Permission[] }
> {
  const invalidate = useTeamMutationInvalidation();

  return useMutation({
    mutationFn: async ({ id, role, permissions }) =>
      (await apiClient.patch<TeamMemberDTO>(`/api/v1/tenant/team/${id}`, { role, permissions })).data,
    onSuccess: invalidate,
  });
}

export function useRemoveMember(): UseMutationResult<
  { seats: SeatUsageDTO },
  ApiClientError,
  { id: string }
> {
  const invalidate = useTeamMutationInvalidation();

  return useMutation({
    mutationFn: async ({ id }) =>
      (await apiClient.delete<{ seats: SeatUsageDTO }>(`/api/v1/tenant/team/${id}`)).data,
    onSuccess: invalidate,
  });
}

export interface ResendInviteResult {
  emailSent: boolean;
  inviteUrl: string | null;
}

export function useResendInvite(): UseMutationResult<
  ResendInviteResult,
  ApiClientError,
  { id: string }
> {
  return useMutation<ResendInviteResult, ApiClientError, { id: string }>({
    mutationFn: async ({ id }) =>
      (await apiClient.post<ResendInviteResult>(`/api/v1/tenant/team/${id}/resend`, {})).data,
  });
}

/** Подпись лимита мест: «7 из 10» либо «10 базовых + 2 дополнительных». */
export function seatsCaption(seats: SeatUsageDTO): string {
  if (seats.extra > 0) {
    return `${seats.included} базовых + ${seats.extra} ${pluralSeat(seats.extra)}`;
  }
  return `${seats.used} из ${seats.included} базовых пользователей`;
}

function pluralSeat(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "дополнительный";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дополнительных";
  return "дополнительных";
}

/** «осталось 5 дней» с правильным склонением. */
export function pluralDays(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
}

export const useTeamMembers = useTeam;
