"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  CreditCard,
  Loader2,
  Mail,
  MoreVertical,
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
  useTeam,
  type AssignableRole,
  type TeamMemberDTO,
} from "@/lib/api/use-team";
import { userInitials } from "@/lib/api/use-tenant-users";
import { cn } from "@/lib/utils";
import type { Permission } from "@/types";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

/** Меню действий строки. Держит открытым только одну строку за раз. */
function MemberActions({
  member,
  assignableRoles,
  availablePermissions,
  onChangeRole,
  onChangePermissions,
  onRemove,
  onResend,
  isBusy,
}: {
  member: TeamMemberDTO;
  assignableRoles: AssignableRole[];
  availablePermissions: Permission[];
  onChangeRole: (role: AssignableRole) => void;
  onChangePermissions: (permissions: Permission[]) => void;
  onRemove: () => void;
  onResend: () => void;
  isBusy: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Владельца и себя менять нельзя — те же правила, что на сервере. Кнопка
  // скрывается, а не блокируется: неактивный элемент без объяснения выглядит
  // как поломка.
  if (member.isOwner || member.isSelf) {
    return <span className="text-xs text-slate-600">{member.isSelf ? "Это вы" : "Владелец"}</span>;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={isBusy}
        aria-label={`Действия для ${member.fullName}`}
        aria-expanded={open}
        className="rounded-[6px] p-1.5 text-[#888888] transition-colors hover:bg-[#fafafa] hover:text-[#111111] disabled:opacity-40"
      >
        {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
      </button>

      {open && (
        <>
          {/* Клик вне меню закрывает его: без этого оно оставалось бы висеть. */}
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
                  "flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-[#fafafa]",
                  role === member.role ? "font-medium text-[#4a38f5]" : "text-[#111111]",
                )}
              >
                {ROLE_LABELS[role]}
                {role === member.role && <ShieldCheck className="h-3.5 w-3.5 text-[#4a38f5]" />}
              </button>
            ))}

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
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[11px] text-[#666666] hover:bg-[#fafafa]"
              >
                <span>{permission}</span>
                {member.permissions.includes(permission) && <ShieldCheck className="h-3 w-3 text-[#4a38f5]" />}
              </button>
            ))}

            {member.status === "invited" && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onResend();
                }}
                className="flex w-full items-center gap-2 border-t border-[#e5e5e5] px-3 py-2 text-left text-xs text-sky-700 transition-colors hover:bg-sky-50"
              >
                <Mail className="h-3.5 w-3.5" />
                Отправить приглашение снова
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onRemove();
              }}
              className="flex w-full items-center gap-2 border-t border-[#e5e5e5] px-3 py-2 text-left text-xs text-rose-600 transition-colors hover:bg-rose-50"
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

  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TeamMemberDTO | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
  const handleResend = useCallback(
    async (member: TeamMemberDTO) => {
      setBusyId(member.id);
      try {
        const result = await resend.mutateAsync({ id: member.id });
        if (result.inviteUrl !== null) {
          await navigator.clipboard?.writeText(result.inviteUrl);
          toast.success("Ссылка обновлена и скопирована в буфер обмена");
        } else {
          toast.success(`Приглашение отправлено повторно на ${member.email}`);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось отправить приглашение");
      } finally {
        setBusyId(null);
      }
    },
    [resend],
  );

  const handleRemove = useCallback(async () => {
    if (removeTarget === null) return;

    try {
      await removeMember.mutateAsync({ id: removeTarget.id });
      toast.success(`${removeTarget.fullName} удалён из компании`);
      setRemoveTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить сотрудника");
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
          className="mt-3 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa]"
        >
          Повторить
        </button>
      </div>
    );
  }

  const { members, seats, assignableRoles, availablePermissions } = data;

  return (
    <div className="space-y-6">
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
          className="flex items-center gap-2 rounded-[8px] bg-[#4a38f5] px-4 py-2 text-[13px] font-medium text-white shadow-2xs transition-colors hover:bg-[#3d2ee0]"
        >
          <UserPlus className="h-4 w-4" />
          Пригласить сотрудника
        </button>
      </div>

      {/* Занятые места и стоимость следующего — чтобы решение о приглашении
          принималось со знанием цены, а не после факта. */}
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
            <span className="text-xs font-medium text-[#666666]">Активных</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#111111] tabular-nums font-mono">
            {members.filter((m) => m.status === "active").length}
            {members.some((m) => m.status === "invited") && (
              <span className="text-sm font-normal text-[#888888]">
                {" "}
                · {members.filter((m) => m.status === "invited").length} приглашено
              </span>
            )}
          </p>
        </div>
      </div>

      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="В компании пока только вы"
          description="Пригласите сотрудников, чтобы работать вместе."
          action={
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="rounded-[8px] bg-[#4a38f5] px-4 py-2 text-[13px] font-medium text-white shadow-2xs hover:bg-[#3d2ee0]"
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
                  E-mail
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
              {members.map((member) => (
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
                          {member.status === "invited"
                            ? member.invitedAt !== null
                              ? `приглашён ${formatDate(member.invitedAt)}`
                              : "приглашён"
                            : `с ${formatDate(member.createdAt)}`}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-[#666666]">{member.email}</td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-[#111111]">{ROLE_LABELS[member.role]}</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      variant={member.status === "active" ? "success" : "warning"}
                      size="sm"
                    >
                      {member.status === "active" ? "Активен" : "Приглашён"}
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
                        onResend={() => void handleResend(member)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-500">
        Стоимость мест и состав модулей —{" "}
        <Link href="/settings/billing" className="text-[#4a38f5] hover:text-[#4a38f5]">
          в разделе «Тариф и оплата»
        </Link>
        .
      </p>

      <InviteMemberModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        seats={seats}
        assignableRoles={assignableRoles}
      />

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
