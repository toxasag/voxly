"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Mail, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiClientError } from "@/lib/api/apiClient";
import {
  ROLE_HINTS,
  ROLE_LABELS,
  useInviteMember,
  type AssignableRole,
  type SeatUsageDTO,
} from "@/lib/api/use-team";
import { inviteMemberSchema, type InviteMemberValues } from "@/schemas/team.schema";
import { useOverlay } from "@/lib/utils/use-scroll-lock";

interface InviteMemberModalProps {
  open: boolean;
  onClose: () => void;
  seats: SeatUsageDTO;
  assignableRoles: AssignableRole[];
}

/**
 * Приглашение сотрудника.
 *
 * Подтверждение платного места реализовано как второй шаг того же окна, а не как
 * отдельный диалог: цена относится к уже заполненной форме, и повторный ввод
 * данных после подтверждения был бы потерей введённого.
 *
 * Согласие всё равно проверяется на сервере (`confirm_extra_seat`): предупредить
 * в интерфейсе недостаточно, запрос можно отправить и минуя его.
 */
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";

export function InviteMemberModal({
  open,
  onClose,
  seats,
  assignableRoles,
}: InviteMemberModalProps) {
  const invite = useInviteMember();
  const [pendingConfirm, setPendingConfirm] = useState<InviteMemberValues | null>(null);

  const form = useForm<InviteMemberValues>({
    resolver: zodResolver(inviteMemberSchema),
    mode: "onChange",
    defaultValues: { name: "", email: "", role: "manager" },
  });

  const role = form.watch("role");
  const willCostExtra = seats.used >= seats.included;

  useOverlay(open, { onEscape: onClose });

  useEffect(() => {
    if (open) {
      form.reset({ name: "", email: "", role: "manager" });
      setPendingConfirm(null);
    }
  }, [open, form]);

  const send = useCallback(
    async (values: InviteMemberValues, confirmExtraSeat: boolean) => {
      try {
        const result = await invite.mutateAsync({
          name: values.name,
          email: values.email,
          role: values.role,
          confirm_extra_seat: confirmExtraSeat,
        });

        toast.success(
          result.emailSent
            ? `Приглашение отправлено на ${result.member.email}`
            : `Сотрудник добавлен, но письмо не отправлено — проверьте настройки почты`,
        );

        setPendingConfirm(null);
        onClose();
      } catch (error) {
        if (error instanceof ApiClientError) {
          if (error.code === "SEAT_LIMIT_CONFIRMATION_REQUIRED") {
            setPendingConfirm(values);
            return;
          }

          if (error.isValidationError) {
            const fields = error.fieldErrors();
            if (fields.email !== undefined) form.setError("email", { message: fields.email });
            if (fields.name !== undefined) form.setError("name", { message: fields.name });
            if (fields.role !== undefined) form.setError("role", { message: fields.role });
            toast.error(fields.email ?? fields.name ?? fields.role ?? error.message);
            return;
          }

          if (error.code === "USER_ALREADY_EXISTS") {
            form.setError("email", { message: "Этот e-mail уже занят активным сотрудником" });
          }

          toast.error(error.message);
          return;
        }

        toast.error("Нет связи с сервером. Повторите попытку.");
      }
    },
    [invite, onClose, form],
  );

  if (!open) return null;

  const errors = form.formState.errors;

  return (
    <Sheet open={open} onClose={onClose} width="w-[500px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
            <UserPlus className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">Пригласить сотрудника</h2>
            <p className="text-xs text-[#666666]">
              {pendingConfirm === null
                ? "Сотрудник задаст пароль по ссылке из письма"
                : "Подтвердите увеличение стоимости"}
            </p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="flex flex-col h-full bg-white text-[#111111]">
        {pendingConfirm !== null ? (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="flex gap-3 rounded-[8px] border border-[#4a38f5]/30 bg-[#4a38f5]/5 p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#4a38f5]" />
                <div className="space-y-1.5 text-xs">
                  <p className="font-semibold text-[#111111]">
                    Базовый лимит ({seats.included} пользователей) исчерпан
                  </p>
                  <p className="leading-relaxed text-[#666666]">
                    Стоимость увеличится на{" "}
                    <span className="font-semibold text-[#111111]">
                      +{seats.extraSeatPrice} ₽/мес
                    </span>{" "}
                    за нового пользователя. Продолжить?
                  </p>
                </div>
              </div>

              <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 text-xs text-[#666666] space-y-1">
                <p>
                  <span className="text-[#888888]">Сотрудник:</span> {pendingConfirm.name}
                </p>
                <p>
                  <span className="text-[#888888]">E-mail:</span> {pendingConfirm.email}
                </p>
                <p>
                  <span className="text-[#888888]">Роль:</span> {ROLE_LABELS[pendingConfirm.role]}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-[#e5e5e5] bg-white px-6 py-4 shrink-0">
              <button
                type="button"
                onClick={() => setPendingConfirm(null)}
                className="rounded-[8px] border border-[#e5e5e5] px-4 py-2 text-xs font-medium text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
              >
                Назад
              </button>
              <button
                type="button"
                onClick={() => void send(pendingConfirm, true)}
                disabled={invite.isPending}
                className="flex items-center gap-2 rounded-[8px] bg-[#4a38f5] px-5 py-2 text-xs font-medium text-white hover:bg-[#3b2be0] transition-colors cursor-pointer disabled:opacity-50"
              >
                {invite.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Приглашаем...</span>
                  </>
                ) : (
                  <span>Продолжить (+{seats.extraSeatPrice} ₽/мес)</span>
                )}
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={form.handleSubmit((values) => void send(values, false))}
            className="flex flex-col flex-1 min-h-0"
          >
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="invite_name" className="block text-xs font-medium text-slate-700">
                  Имя и фамилия
                </label>
                <input
                  id="invite_name"
                  autoFocus
                  placeholder="Иван Петров"
                  {...form.register("name")}
                  className={cn(
                    "w-full rounded-[4px] border bg-white px-3 py-2 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                    errors.name !== undefined ? "border-rose-500" : "border-[#e5e5e5]",
                  )}
                />
                {errors.name && <p className="text-xs text-rose-500">{errors.name.message}</p>}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="invite_email" className="block text-xs font-medium text-slate-700">
                  E-mail
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="invite_email"
                    type="email"
                    placeholder="ivan@company.ru"
                    {...form.register("email")}
                    className={cn(
                      "w-full rounded-[4px] border bg-white py-2 pl-10 pr-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                      errors.email !== undefined ? "border-rose-500" : "border-[#e5e5e5]",
                    )}
                  />
                </div>
                {errors.email && <p className="text-xs text-rose-500">{errors.email.message}</p>}
              </div>

              <fieldset className="space-y-2">
                <legend className="block text-xs font-medium text-slate-700">Роль</legend>
                <div className="grid grid-cols-2 gap-2">
                  {assignableRoles.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => form.setValue("role", value, { shouldValidate: true })}
                      className={cn(
                        "rounded-[6px] border px-3 py-2 text-left text-xs font-medium transition-colors cursor-pointer",
                        role === value
                          ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                          : "border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#f5f5f5]",
                      )}
                    >
                      {ROLE_LABELS[value]}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-[#888888]">{ROLE_HINTS[role]}</p>
              </fieldset>

              {willCostExtra && (
                <p className="flex items-start gap-2 rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] p-3 text-xs text-[#666666]">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  Базовые {seats.included} мест заняты — новый сотрудник добавит{" "}
                  +{seats.extraSeatPrice} ₽/мес к подписке.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-[#e5e5e5] bg-white px-6 py-4 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="rounded-[8px] border border-[#e5e5e5] px-4 py-2 text-xs font-medium text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={invite.isPending}
                className="flex items-center gap-2 rounded-[8px] bg-[#4a38f5] px-5 py-2 text-xs font-medium text-white hover:bg-[#3b2be0] transition-colors cursor-pointer disabled:opacity-50"
              >
                {invite.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Приглашаем...</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4" />
                    <span>Пригласить</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
