"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Mail, UserPlus, X } from "lucide-react";
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

  // Единый стек оверлеев. Закрывает два дефекта разом: прямая правка
  // `body.style.overflow` возвращала прокрутку фону при закрытии верхнего из
  // нескольких оверлеев, а собственный слушатель Escape закрывал их все сразу.
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
          // Сервер требует подтверждения доплаты: показываем второй шаг вместо
          // ошибки — пользователь ещё не отказывался, его просто не спросили.
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

  const backdrop = useCallback(
    (event: React.MouseEvent) => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose],
  );

  if (!open) return null;

  const errors = form.formState.errors;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={backdrop}
    >
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10">
              <UserPlus className="h-4 w-4 text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Пригласить сотрудника</h2>
              <p className="text-xs text-slate-500">
                {pendingConfirm === null
                  ? "Сотрудник задаст пароль по ссылке из письма"
                  : "Подтвердите увеличение стоимости"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/*
          Второй шаг: цена нового места. Показывается только после отказа
          сервера, поэтому пользователь не видит предупреждения, пока места
          включены в тариф.
        */}
        {pendingConfirm !== null ? (
          <div className="space-y-4 p-6">
            <div className="flex gap-3 rounded-lg border border-[#4a38f5]/30 bg-[#4a38f5]/5 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div className="space-y-2 text-sm">
                <p className="font-medium text-slate-100">
                  Базовый лимит ({seats.included} пользователей) исчерпан
                </p>
                <p className="leading-relaxed text-slate-400">
                  Стоимость увеличится на{" "}
                  <span className="font-semibold text-amber-400">
                    +{seats.extraSeatPrice} ₽/мес
                  </span>{" "}
                  за нового пользователя. Продолжить?
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
              <p>
                <span className="text-slate-500">Сотрудник:</span> {pendingConfirm.name}
              </p>
              <p className="mt-1">
                <span className="text-slate-500">E-mail:</span> {pendingConfirm.email}
              </p>
              <p className="mt-1">
                <span className="text-slate-500">Роль:</span> {ROLE_LABELS[pendingConfirm.role]}
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => setPendingConfirm(null)}
                className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
              >
                Назад
              </button>
              <button
                type="button"
                onClick={() => void send(pendingConfirm, true)}
                disabled={invite.isPending}
                className="flex items-center gap-2 rounded-lg bg-[#4a38f5] px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#3b2be0] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {invite.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Приглашаем...
                  </>
                ) : (
                  `Продолжить (+${seats.extraSeatPrice} ₽/мес)`
                )}
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={form.handleSubmit((values) => void send(values, false))}
            className="space-y-4 p-6"
          >
            <div className="space-y-2">
              <label htmlFor="invite_name" className="block text-xs font-medium text-slate-400">
                Имя и фамилия
              </label>
              <input
                id="invite_name"
                autoFocus
                placeholder="Иван Петров"
                {...form.register("name")}
                className={cn(
                  "w-full rounded-lg border bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500",
                  "focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
                  errors.name !== undefined ? "border-rose-500" : "border-slate-700",
                )}
              />
              {errors.name && <p className="text-xs text-rose-400">{errors.name.message}</p>}
            </div>

            <div className="space-y-2">
              <label htmlFor="invite_email" className="block text-xs font-medium text-slate-400">
                E-mail
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="invite_email"
                  type="email"
                  placeholder="ivan@company.ru"
                  {...form.register("email")}
                  className={cn(
                    "w-full rounded-lg border bg-slate-950 py-2.5 pl-10 pr-3.5 text-sm text-slate-100 placeholder:text-slate-500",
                    "focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
                    errors.email !== undefined ? "border-rose-500" : "border-slate-700",
                  )}
                />
              </div>
              {errors.email && <p className="text-xs text-rose-400">{errors.email.message}</p>}
            </div>

            <fieldset className="space-y-2">
              <legend className="block text-xs font-medium text-slate-400">Роль</legend>
              <div className="grid grid-cols-2 gap-2">
                {assignableRoles.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => form.setValue("role", value, { shouldValidate: true })}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors",
                      role === value
                        ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                        : "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200",
                    )}
                  >
                    {ROLE_LABELS[value]}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">{ROLE_HINTS[role]}</p>
            </fieldset>

            {/*
              Предупреждение до отправки, когда места уже исчерпаны: узнать о
              доплате в момент нажатия «Пригласить» — неприятная неожиданность.
            */}
            {willCostExtra && (
              <p className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                Базовые {seats.included} мест заняты — новый сотрудник добавит{" "}
                +{seats.extraSeatPrice} ₽/мес к подписке.
              </p>
            )}

            <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={invite.isPending}
                className="flex items-center gap-2 rounded-lg bg-[#4a38f5] px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#3b2be0] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {invite.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Приглашаем...
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4" />
                    Пригласить
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
