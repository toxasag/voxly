"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  Loader2,
  Mail,
  MessageCircle,
  MoreVertical,
  Phone,
  RotateCw,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { Guard } from "@/components/shared/Guard";
import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonTable } from "@/components/shared/Skeleton";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { InviteMemberModal } from "@/components/settings/InviteMemberModal";
import {
  ROLE_LABELS,
  seatsCaption,
  useChangeMemberRole,
  useRemoveMember,
  useResendInvite,
  useRevokeInvite,
  useTeam,
  type AssignableRole,
  type PendingInviteDTO,
  type TeamMemberDTO,
} from "@/lib/api/use-team";
import { userInitials } from "@/lib/api/use-tenant-users";
import { cn, formatPhone } from "@/lib/utils";
import type { Permission } from "@/types";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** Меню действий строки активного сотрудника. */
function MemberActions({
  member,
  assignableRoles,
  availablePermissions,
  onChangeRole,
  onChangePermissions,
  onRemove,
  isBusy,
}: {
  member: TeamMemberDTO;
  assignableRoles: AssignableRole[];
  availablePermissions: Permission[];
  onChangeRole: (role: AssignableRole) => void;
  onChangePermissions: (permissions: Permission[]) => void;
  onRemove: () => void;
  isBusy: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (member.isOwner || member.isSelf) {
    return <span className="text-xs text-[#888888]">{member.isSelf ? "Это вы" : "Владелец"}</span>;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={isBusy}
        aria-label={`Действия для ${member.fullName}`}
        aria-expanded={open}
        className="rounded-[6px] p-1.5 text-[#888888] transition-colors hover:bg-[#fafafa] hover:text-[#111111] disabled:opacity-40 cursor-pointer"
      >
        {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />

          <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white shadow-lg">
            <p className="border-b border-[#e5e5e5] px-3 py-2 text-xs font-semibold uppercase tracking-wider text-[#888888]">
              Изменить роль
            </p>
            {assignableRoles.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (role !== member.role) onChangeRole(role);
                }}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-[#fafafa] cursor-pointer",
                  role === member.role ? "font-medium text-[#4a38f5]" : "text-[#111111]",
                )}
              >
                {ROLE_LABELS[role]}
                {role === member.role && <ShieldCheck className="h-3.5 w-3.5 text-[#4a38f5]" />}
              </button>
            ))}

            {availablePermissions.length > 0 && (
              <>
                <p className="border-t border-[#e5e5e5] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#888888]">
                  Точечные права
                </p>
                {availablePermissions.map((permission) => (
                  <button
                    key={permission}
                    type="button"
                    onClick={() => {
                      const next = member.permissions.includes(permission)
                        ? member.permissions.filter((item) => item !== permission)
                        : [...member.permissions, permission];
                      setOpen(false);
                      onChangePermissions(next);
                    }}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[11px] text-[#666666] hover:bg-[#fafafa] cursor-pointer"
                  >
                    <span>{permission}</span>
                    {member.permissions.includes(permission) && <ShieldCheck className="h-3 w-3 text-[#4a38f5]" />}
                  </button>
                ))}
              </>
            )}

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onRemove();
              }}
              className="flex w-full items-center gap-2 border-t border-[#e5e5e5] px-3 py-2 text-left text-xs text-rose-600 transition-colors hover:bg-rose-50 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Удалить сотрудника
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function TeamContent() {
  const { data, isLoading, isError, error, refetch } = useTeam();
  const changeRole = useChangeMemberRole();
  const removeMember = useRemoveMember();
  const resend = useResendInvite();
  const revoke = useRevokeInvite();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TeamMemberDTO | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<PendingInviteDTO | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);

  const handleChangeRole = useCallback(
    async (member: TeamMemberDTO, role: AssignableRole) => {
      setBusyId(member.id);
      try {
        await changeRole.mutateAsync({ id: member.id, role });
        toast.success(`${member.fullName}: роль изменена на «${ROLE_LABELS[role]}»`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось изменить роль");
      } finally {
        setBusyId(null);
      }
    },
    [changeRole],
  );

  const handleChangePermissions = useCallback(
    async (member: TeamMemberDTO, permissions: Permission[]) => {
      setBusyId(member.id);
      try {
        await changeRole.mutateAsync({ id: member.id, role: member.role as AssignableRole, permissions });
        toast.success(`${member.fullName}: права обновлены`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось обновить права");
      } finally {
        setBusyId(null);
      }
    },
    [changeRole],
  );

  const handleCopyInviteLink = useCallback(
    async (invite: PendingInviteDTO) => {
      if (invite.inviteUrl) {
        try {
          await navigator.clipboard.writeText(invite.inviteUrl);
          setCopiedInviteId(invite.id);
          toast.success("Ссылка приглашения скопирована в буфер обмена");
          setTimeout(() => setCopiedInviteId(null), 2500);
          return;
        } catch {
          // fallback to resend below
        }
      }

      setBusyId(invite.id);
      try {
        const result = await resend.mutateAsync({ id: invite.id });
        if (result.inviteUrl) {
          await navigator.clipboard.writeText(result.inviteUrl);
          setCopiedInviteId(invite.id);
          toast.success("Ссылка обновлена и скопирована в буфер обмена");
          setTimeout(() => setCopiedInviteId(null), 2500);
        } else {
          toast.success(`Приглашение отправлено повторно`);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось получить ссылку");
      } finally {
        setBusyId(null);
      }
    },
    [resend],
  );

  const handleResendInvite = useCallback(
    async (invite: PendingInviteDTO) => {
      setBusyId(invite.id);
      try {
        const result = await resend.mutateAsync({ id: invite.id });
        if (result.inviteUrl) {
          await navigator.clipboard.writeText(result.inviteUrl);
          toast.success(
            result.emailSent
              ? `Приглашение отправлено на ${invite.email}, ссылка скопирована в буфер`
              : "Ссылка приглашения обновлена и скопирована в буфер обмена",
          );
        } else {
          toast.success(`Приглашение отправлено повторно на ${invite.email ?? invite.phone}`);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось отправить приглашение");
      } finally {
        setBusyId(null);
      }
    },
    [resend],
  );

  const handleRevokeInvite = useCallback(async () => {
    if (revokeTarget === null) return;
    setBusyId(revokeTarget.id);
    try {
      await revoke.mutateAsync({ id: revokeTarget.id });
      toast.success(`Приглашение для «${revokeTarget.name}» отозвано`);
      setRevokeTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось отозвать приглашение");
    } finally {
      setBusyId(null);
    }
  }, [revoke, revokeTarget]);

  const handleRemove = useCallback(async () => {
    if (removeTarget === null) return;
    setBusyId(removeTarget.id);
    try {
      await removeMember.mutateAsync({ id: removeTarget.id });
      toast.success(`${removeTarget.fullName} удалён из компании`);
      setRemoveTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить сотрудника");
    } finally {
      setBusyId(null);
    }
  }, [removeMember, removeTarget]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-16 rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs" />
        <SkeletonTable rows={5} columns={5} />
      </div>
    );
  }

  if (isError || data === undefined) {
    return (
      <div role="alert" className="rounded-[8px] border border-rose-200 bg-rose-50 p-6">
        <p className="text-sm font-semibold text-rose-900">Не удалось загрузить список сотрудников</p>
        <p className="mt-1 text-sm text-rose-700">{error?.message ?? "неизвестная ошибка"}</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-3 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] cursor-pointer"
        >
          Повторить
        </button>
      </div>
    );
  }

  const { members, seats, assignableRoles, availablePermissions } = data;
  const pendingInvites = data.invites ?? [];
  const activeMembers = members.filter((m) => m.status === "active");

  return (
    <div className="space-y-6">
      {/* Шапка страницы */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#111111]">Сотрудники компании</h1>
          <p className="mt-1 text-[13px] text-[#666666]">
            {seatsCaption(seats)}
            {seats.extra > 0 && (
              <span className="text-[#888888]">
                {" "}
                · доплата {seats.extra * seats.extraSeatPrice} ₽/мес
              </span>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="flex items-center gap-2 rounded-[8px] bg-[#4a38f5] px-4 py-2 text-[13px] font-medium text-white shadow-2xs transition-colors hover:bg-[#3d2ee0] cursor-pointer"
        >
          <UserPlus className="h-4 w-4" />
          Пригласить сотрудника
        </button>
      </div>

      {/* Метрики занятости мест */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white px-5 py-4 shadow-2xs">
          <div className="flex items-center gap-2">
            <div className="rounded-[6px] bg-sky-50 p-1.5">
              <Users className="h-4 w-4 text-sky-600" />
            </div>
            <span className="text-xs font-medium text-[#666666]">Занято мест</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#111111] tabular-nums font-mono">
            {seats.used}
            <span className="text-sm font-normal text-[#888888]"> / {seats.included} базовых</span>
          </p>
        </div>

        <div className="rounded-[8px] border border-[#e5e5e5] bg-white px-5 py-4 shadow-2xs">
          <div className="flex items-center gap-2">
            <div className="rounded-[6px] bg-indigo-50 p-1.5">
              <CreditCard className="h-4 w-4 text-[#4a38f5]" />
            </div>
            <span className="text-xs font-medium text-[#666666]">Следующий сотрудник</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#111111] tabular-nums font-mono">
            {seats.nextSeatPrice === 0 ? (
              <span className="text-emerald-700">Бесплатно</span>
            ) : (
              `+${seats.extraSeatPrice} ₽/мес`
            )}
          </p>
        </div>

        <div className="rounded-[8px] border border-[#e5e5e5] bg-white px-5 py-4 shadow-2xs">
          <div className="flex items-center gap-2">
            <div className="rounded-[6px] bg-emerald-50 p-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-700" />
            </div>
            <span className="text-xs font-medium text-[#666666]">Активных / Приглашено</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#111111] tabular-nums font-mono">
            {activeMembers.length}
            <span className="text-sm font-normal text-[#888888]">
              {" "}
              · {pendingInvites.length} в ожидании
            </span>
          </p>
        </div>
      </div>

      {/* =====================================================================
          СЕКЦИЯ: ОЖИДАЮЩИЕ ПРИГЛАШЕНИЯ (ОМНИКАНАЛЬНЫЙ АУДИТ)
          ===================================================================== */}
      {pendingInvites.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-[#111111]">Ожидающие приглашения</h2>
              <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-800">
                {pendingInvites.length}
              </span>
            </div>
            <p className="text-xs text-[#888888]">
              Сотрудники получат доступ сразу после активации ссылки
            </p>
          </div>

          <div className="overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-[#666666]">
                    Получатель
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-[#666666]">
                    Роль
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-[#666666]">
                    Отправлено
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-[#666666]">
                    Статус доставки
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-[#666666]">
                    Действия
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f0]">
                {pendingInvites.map((invite) => {
                  const isBusy = busyId === invite.id;
                  const isCopied = copiedInviteId === invite.id;

                  return (
                    <tr key={invite.id} className="transition-colors hover:bg-[#fafafa]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-xs font-semibold text-amber-700">
                            {userInitials(invite.name)}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-[#111111]">
                              {invite.name}
                            </p>
                            <p className="flex items-center gap-1.5 text-xs text-[#666666]">
                              {invite.email ? (
                                <>
                                  <Mail className="h-3 w-3 text-[#888888]" />
                                  <span>{invite.email}</span>
                                </>
                              ) : invite.phone ? (
                                <>
                                  <Phone className="h-3 w-3 text-[#888888]" />
                                  <span className="font-mono">{formatPhone(invite.phone)}</span>
                                </>
                              ) : (
                                <span>По ссылке</span>
                              )}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <span className="text-xs font-medium text-[#111111]">
                          {ROLE_LABELS[invite.role] ?? invite.role}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-xs text-[#666666]">
                        {formatDateTime(invite.createdAt)}
                      </td>

                      <td className="px-4 py-3">
                        {invite.isExpired ? (
                          <StatusBadge variant="warning" size="sm">
                            Истекло
                          </StatusBadge>
                        ) : invite.deliveryStatus === "failed" ? (
                          <div className="flex items-center gap-1.5" title={invite.deliveryError ?? "Ошибка SMTP"}>
                            <StatusBadge variant="destructive" size="sm">
                              Ошибка доставки
                            </StatusBadge>
                          </div>
                        ) : invite.deliveryStatus === "sent" ? (
                          <StatusBadge variant="success" size="sm">
                            Письмо отправлено
                          </StatusBadge>
                        ) : invite.phone ? (
                          <StatusBadge variant="info" size="sm">
                            По номеру
                          </StatusBadge>
                        ) : (
                          <StatusBadge variant="neutral" size="sm">
                            Ссылка создана
                          </StatusBadge>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* Скопировать ссылку */}
                          <button
                            type="button"
                            onClick={() => void handleCopyInviteLink(invite)}
                            disabled={isBusy}
                            title="Скопировать ссылку приглашения"
                            className="flex items-center gap-1 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] transition-colors cursor-pointer disabled:opacity-40"
                          >
                            {isCopied ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-600" />
                                <span className="text-emerald-700">Скопировано</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3 text-[#666666]" />
                                <span>Ссылка</span>
                              </>
                            )}
                          </button>

                          {/* Поделиться в Telegram */}
                          {invite.telegramShareUrl && (
                            <a
                              href={invite.telegramShareUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Отправить приглашение в Telegram"
                              className="rounded-[6px] border border-sky-200 bg-sky-50/60 p-1.5 text-sky-700 hover:bg-sky-100 transition-colors"
                            >
                              <Send className="h-3.5 w-3.5" />
                            </a>
                          )}

                          {/* Поделиться в WhatsApp */}
                          {invite.whatsappShareUrl && (
                            <a
                              href={invite.whatsappShareUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Отправить приглашение в WhatsApp"
                              className="rounded-[6px] border border-emerald-200 bg-emerald-50/60 p-1.5 text-emerald-700 hover:bg-emerald-100 transition-colors"
                            >
                              <MessageCircle className="h-3.5 w-3.5" />
                            </a>
                          )}

                          {/* Повторить отправку */}
                          <button
                            type="button"
                            onClick={() => void handleResendInvite(invite)}
                            disabled={isBusy}
                            title="Отправить повторно"
                            className="rounded-[6px] p-1.5 text-[#666666] hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors cursor-pointer disabled:opacity-40"
                          >
                            {isBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCw className="h-3.5 w-3.5" />
                            )}
                          </button>

                          {/* Отозвать */}
                          <button
                            type="button"
                            onClick={() => setRevokeTarget(invite)}
                            disabled={isBusy}
                            title="Отозвать приглашение"
                            className="rounded-[6px] p-1.5 text-rose-500 hover:bg-rose-50 hover:text-rose-700 transition-colors cursor-pointer disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          СЕКЦИЯ: ДЕЙСТВУЮЩИЕ СОТРУДНИКИ
          ===================================================================== */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[#111111]">Действующие сотрудники</h2>
            <span className="rounded-full bg-[#f0f0f0] px-2 py-0.5 text-xs font-semibold text-[#666666]">
              {activeMembers.length}
            </span>
          </div>
        </div>

        {activeMembers.length === 0 ? (
          <EmptyState
            icon={Users}
            title="В компании пока только вы"
            description="Пригласите сотрудников, чтобы работать вместе над сделками и клиентами."
            action={
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                className="rounded-[8px] bg-[#4a38f5] px-4 py-2 text-[13px] font-medium text-white shadow-2xs hover:bg-[#3d2ee0] cursor-pointer"
              >
                Пригласить сотрудника
              </button>
            }
          />
        ) : (
          <div className="overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-[#666666]">
                    Имя
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-[#666666]">
                    Контакт
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-[#666666]">
                    Роль
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-[#666666]">
                    Статус
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-[#666666]">
                    Действия
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f0]">
                {activeMembers.map((member) => (
                  <tr key={member.id} className="transition-colors hover:bg-[#fafafa]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f0f0f0] text-xs font-semibold text-[#111111]">
                          {userInitials(member.fullName)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[#111111]">
                            {member.fullName}
                          </p>
                          <p className="text-xs text-[#666666]">
                            с {formatDate(member.createdAt)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-[#666666]">
                      {member.email ?? (member.phone ? formatPhone(member.phone) : "—")}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-[#111111]">{ROLE_LABELS[member.role] ?? member.role}</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge variant="success" size="sm">
                        Активен
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end">
                        <MemberActions
                          member={member}
                          assignableRoles={assignableRoles}
                          availablePermissions={availablePermissions}
                          isBusy={busyId === member.id}
                          onChangeRole={(role) => void handleChangeRole(member, role)}
                          onChangePermissions={(permissions) => void handleChangePermissions(member, permissions)}
                          onRemove={() => setRemoveTarget(member)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500">
        Стоимость мест и состав модулей —{" "}
        <Link href="/settings/billing" className="text-[#4a38f5] hover:text-[#4a38f5]">
          в разделе «Тариф и оплата»
        </Link>
        .
      </p>

      {/* Модальное окно приглашения */}
      <InviteMemberModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        seats={seats}
        assignableRoles={assignableRoles}
      />

      {/* Диалог подтверждения удаления сотрудника */}
      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemove}
        title="Удалить сотрудника?"
        description={
          removeTarget === null
            ? undefined
            : `${removeTarget.fullName} потеряет доступ немедленно, все его сессии будут завершены. Созданные им сделки, задачи и записи сохранятся.`
        }
        confirmLabel="Удалить"
        variant="destructive"
        isPending={removeMember.isPending}
      />

      {/* Диалог подтверждения отзыва приглашения */}
      <ConfirmDialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleRevokeInvite}
        title="Отозвать приглашение?"
        description={
          revokeTarget === null
            ? undefined
            : `Приглашение для «${revokeTarget.name}» (${revokeTarget.email ?? revokeTarget.phone}) будет аннулировано. Ссылка перестанет действовать.`
        }
        confirmLabel="Отозвать"
        variant="destructive"
        isPending={revoke.isPending}
      />
    </div>
  );
}

export default function TeamSettingsPage() {
  return (
    <Guard
      requiredPermission="tenant:admin"
      fallback={
        <EmptyState
          icon={Users}
          title="Нет доступа к управлению сотрудниками"
          description="Раздел доступен владельцу и администраторам компании."
        />
      }
    >
      <TeamContent />
    </Guard>
  );
}
