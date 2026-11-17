"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  Send,
  UserPlus,
} from "lucide-react";
import { cn, formatPhone } from "@/lib/utils";
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
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/shared/StatusBadge";

interface InviteMemberModalProps {
  open: boolean;
  onClose: () => void;
  seats: SeatUsageDTO;
  assignableRoles: AssignableRole[];
}

interface CreatedInviteInfo {
  name: string;
  recipient: string;
  role: AssignableRole;
  emailSent: boolean;
  inviteUrl: string;
  telegramShareUrl?: string | null;
  whatsappShareUrl?: string | null;
  channel: "email" | "phone";
}

export function InviteMemberModal({
  open,
  onClose,
  seats,
  assignableRoles,
}: InviteMemberModalProps) {
  const invite = useInviteMember();
  const [pendingConfirm, setPendingConfirm] = useState<InviteMemberValues | null>(null);
  const [createdInvite, setCreatedInvite] = useState<CreatedInviteInfo | null>(null);
  const [copied, setCopied] = useState(false);

  const form = useForm<InviteMemberValues>({
    resolver: zodResolver(inviteMemberSchema),
    mode: "onChange",
    defaultValues: { name: "", channel: "email", email: "", phone: "", role: "manager" },
  });

  const channel = form.watch("channel");
  const role = form.watch("role");
  const willCostExtra = seats.used >= seats.included;

  useOverlay(open, { onEscape: onClose });

  useEffect(() => {
    if (open) {
      form.reset({ name: "", channel: "email", email: "", phone: "", role: "manager" });
      setPendingConfirm(null);
      setCreatedInvite(null);
      setCopied(false);
    }
  }, [open, form]);

  const send = useCallback(
    async (values: InviteMemberValues, confirmExtraSeat: boolean) => {
      try {
        const payload = {
          name: values.name,
          email: values.channel === "email" ? values.email : null,
          phone: values.channel === "phone" ? values.phone?.replace(/\D/g, "") : null,
          role: values.role,
          confirm_extra_seat: confirmExtraSeat,
        };

        const result = await invite.mutateAsync(payload);

        const inviteLink = result.inviteUrl || (result.invite?.inviteUrl ?? "");
        const tgLink = result.telegramShareUrl || (result.invite?.telegramShareUrl ?? null);
        const waLink = result.whatsappShareUrl || (result.invite?.whatsappShareUrl ?? null);

        setPendingConfirm(null);
        setCreatedInvite({
          name: values.name,
          recipient: (values.channel === "email" ? values.email : values.phone) || "",
          role: values.role,
          emailSent: result.emailSent,
          inviteUrl: inviteLink,
          telegramShareUrl: tgLink,
          whatsappShareUrl: waLink,
          channel: values.channel,
        });

        if (values.channel === "email") {
          toast.success(
            result.emailSent
              ? `Приглашение отправлено на ${values.email}`
              : `Сотрудник добавлен. Письмо не отправлено — передайте ссылку лично`,
          );
        } else {
          toast.success(`Приглашение создано для номера ${values.phone}`);
        }
      } catch (error) {
        if (error instanceof ApiClientError) {
          if (error.code === "SEAT_LIMIT_CONFIRMATION_REQUIRED") {
            setPendingConfirm(values);
            return;
          }

          if (error.isValidationError) {
            const fields = error.fieldErrors();
            if (fields.email !== undefined) form.setError("email", { message: fields.email });
            if (fields.phone !== undefined) form.setError("phone", { message: fields.phone });
            if (fields.name !== undefined) form.setError("name", { message: fields.name });
            if (fields.role !== undefined) form.setError("role", { message: fields.role });
            toast.error(fields.email ?? fields.phone ?? fields.name ?? fields.role ?? error.message);
            return;
          }

          if (error.code === "USER_ALREADY_EXISTS") {
            const targetField = values.channel === "email" ? "email" : "phone";
            form.setError(targetField, { message: "Сотрудник с этим контактом уже работает в компании" });
          }

          toast.error(error.message);
          return;
        }

        toast.error("Нет связи с сервером. Повторите попытку.");
      }
    },
    [invite, form],
  );

  const handleCopyLink = useCallback(async () => {
    if (!createdInvite?.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(createdInvite.inviteUrl);
      setCopied(true);
      toast.success("Ссылка скопирована в буфер обмена");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Не удалось скопировать ссылку");
    }
  }, [createdInvite]);

  if (!open) return null;

  const errors = form.formState.errors;

  return (
    <Sheet open={open} onClose={onClose} width="w-[520px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#4a38f5]/10 text-[#4a38f5]">
            <UserPlus className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-[13.3px] font-semibold text-[#111111]">
              {createdInvite !== null ? "Приглашение создано" : "Пригласить сотрудника"}
            </h2>
            <p className="text-xs text-[#666666]">
              {createdInvite !== null
                ? "Передайте ссылку сотруднику или отправьте в мессенджер"
                : pendingConfirm === null
                  ? "Выберите канал и укажите данные сотрудника"
                  : "Подтвердите увеличение стоимости тарифа"}
            </p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="flex flex-col h-full bg-white text-[#111111]">
        {createdInvite !== null ? (
          <div className="flex flex-1 flex-col justify-between p-6 overflow-y-auto">
            <div className="space-y-5">
              {/* Карточка созданного приглашения */}
              <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-[#111111]">{createdInvite.name}</h3>
                    <p className="text-xs text-[#666666] mt-0.5">
                      {createdInvite.recipient} · {ROLE_LABELS[createdInvite.role]}
                    </p>
                  </div>
                  {createdInvite.channel === "email" ? (
                    <StatusBadge variant={createdInvite.emailSent ? "success" : "warning"} size="sm">
                      {createdInvite.emailSent ? "Письмо отправлено" : "Письмо не доставлено"}
                    </StatusBadge>
                  ) : (
                    <StatusBadge variant="info" size="sm">
                      По номеру телефона
                    </StatusBadge>
                  )}
                </div>

                {createdInvite.channel === "email" && !createdInvite.emailSent && (
                  <p className="text-xs text-[#854d0e] bg-[#fefce8] border border-[#fef08a] rounded-[4px] p-2.5">
                    Почтовый сервер временно не доставил письмо. Вы можете передать ссылку сотруднику вручную
                    или отправить в Telegram / WhatsApp.
                  </p>
                )}
              </div>

              {/* Поле со ссылкой и кнопка копирования */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[#111111]">
                  Персональная ссылка приглашения
                </label>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={createdInvite.inviteUrl}
                    onFocus={(event) => event.currentTarget.select()}
                    className="flex-1 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-xs font-mono tabular-nums text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    aria-label="Ссылка приглашения"
                  />
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] transition-colors cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                        <span className="text-emerald-700">Скопировано</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 text-[#666666]" />
                        <span>Копировать</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Кнопки мгновенного шаринга в мессенджеры */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-[#666666]">
                  Быстрая отправка в мессенджеры
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  {createdInvite.telegramShareUrl ? (
                    <a
                      href={createdInvite.telegramShareUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 rounded-[8px] border border-sky-200 bg-sky-50/60 px-3.5 py-2.5 text-xs font-medium text-sky-800 transition-colors hover:bg-sky-100 hover:border-sky-300"
                    >
                      <Send className="h-4 w-4 text-sky-600" />
                      <span>В Telegram</span>
                      <ExternalLink className="h-3 w-3 opacity-60 ml-auto" />
                    </a>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="flex items-center justify-center gap-2 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] px-3.5 py-2.5 text-xs font-medium text-[#888888] opacity-50 cursor-not-allowed"
                    >
                      <Send className="h-4 w-4" />
                      <span>В Telegram</span>
                    </button>
                  )}

                  {createdInvite.whatsappShareUrl ? (
                    <a
                      href={createdInvite.whatsappShareUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 rounded-[8px] border border-emerald-200 bg-emerald-50/60 px-3.5 py-2.5 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100 hover:border-emerald-300"
                    >
                      <MessageCircle className="h-4 w-4 text-emerald-600" />
                      <span>В WhatsApp</span>
                      <ExternalLink className="h-3 w-3 opacity-60 ml-auto" />
                    </a>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="flex items-center justify-center gap-2 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] px-3.5 py-2.5 text-xs font-medium text-[#888888] opacity-50 cursor-not-allowed"
                    >
                      <MessageCircle className="h-4 w-4" />
                      <span>В WhatsApp</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-6 border-t border-[#e5e5e5]">
              <button
                type="button"
                onClick={onClose}
                className="h-8 rounded-[8px] bg-[#4a38f5] px-5 text-[13px] font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] cursor-pointer"
              >
                Готово
              </button>
            </div>
          </div>
        ) : pendingConfirm !== null ? (
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
                  <span className="text-[#888888]">
                    {pendingConfirm.channel === "email" ? "E-mail:" : "Телефон:"}
                  </span>{" "}
                  {pendingConfirm.channel === "email" ? pendingConfirm.email : pendingConfirm.phone}
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
                className="h-8 rounded-[8px] border border-[#e5e5e5] px-4 text-[13px] font-medium text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
              >
                Назад
              </button>
              <button
                type="button"
                onClick={() => void send(pendingConfirm, true)}
                disabled={invite.isPending}
                className="flex items-center gap-2 h-8 rounded-[8px] bg-[#4a38f5] px-5 text-[13px] font-medium text-white hover:bg-[#3d2ee0] transition-colors cursor-pointer disabled:opacity-50"
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
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Переключатель каналов: Email / Телефон */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[#111111]">
                  Способ приглашения
                </label>
                <div className="grid grid-cols-2 gap-2 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-1">
                  <button
                    type="button"
                    onClick={() => form.setValue("channel", "email", { shouldValidate: true })}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-[6px] py-1.5 text-xs font-medium transition-colors cursor-pointer",
                      channel === "email"
                        ? "bg-white text-[#111111] shadow-2xs border border-[#e5e5e5]"
                        : "text-[#666666] hover:text-[#111111]",
                    )}
                  >
                    <Mail className="h-3.5 w-3.5" />
                    <span>По E-mail</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => form.setValue("channel", "phone", { shouldValidate: true })}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-[6px] py-1.5 text-xs font-medium transition-colors cursor-pointer",
                      channel === "phone"
                        ? "bg-white text-[#111111] shadow-2xs border border-[#e5e5e5]"
                        : "text-[#666666] hover:text-[#111111]",
                    )}
                  >
                    <Phone className="h-3.5 w-3.5" />
                    <span>По телефону</span>
                  </button>
                </div>
              </div>

              {/* Имя и фамилия */}
              <div className="space-y-1.5">
                <label htmlFor="invite_name" className="block text-xs font-medium text-[#111111]">
                  Имя и фамилия сотрудника
                </label>
                <input
                  id="invite_name"
                  autoFocus
                  placeholder="Иван Петров"
                  {...form.register("name")}
                  className={cn(
                    "w-full rounded-[8px] border bg-white px-3 py-2 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                    errors.name !== undefined ? "border-rose-500" : "border-[#e5e5e5]",
                  )}
                />
                {errors.name && <p className="text-xs text-rose-600">{errors.name.message}</p>}
              </div>

              {/* Поле E-mail или Телефон в зависимости от канала */}
              {channel === "email" ? (
                <div className="space-y-1.5">
                  <label htmlFor="invite_email" className="block text-xs font-medium text-[#111111]">
                    E-mail адрес
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#888888]" />
                    <input
                      id="invite_email"
                      type="email"
                      placeholder="ivan@company.ru"
                      {...form.register("email")}
                      className={cn(
                        "w-full rounded-[8px] border bg-white py-2 pl-9 pr-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                        errors.email !== undefined ? "border-rose-500" : "border-[#e5e5e5]",
                      )}
                    />
                  </div>
                  {errors.email && <p className="text-xs text-rose-600">{errors.email.message}</p>}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label htmlFor="invite_phone" className="block text-xs font-medium text-[#111111]">
                    Номер телефона
                  </label>
                  <div className="relative">
                    <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#888888]" />
                    <input
                      id="invite_phone"
                      type="tel"
                      inputMode="tel"
                      placeholder="+7 999 123 45 67"
                      value={form.watch("phone") ?? ""}
                      onChange={(event) =>
                        form.setValue("phone", formatPhone(event.target.value), { shouldValidate: true })
                      }
                      className={cn(
                        "w-full rounded-[8px] border bg-white py-2 pl-9 pr-3 text-xs font-mono tabular-nums text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                        errors.phone !== undefined ? "border-rose-500" : "border-[#e5e5e5]",
                      )}
                    />
                  </div>
                  {errors.phone ? (
                    <p className="text-xs text-rose-600">{errors.phone.message}</p>
                  ) : (
                    <p className="text-xs text-[#888888]">
                      Ссылка будет сгенерирована сразу для отправки в Telegram или WhatsApp
                    </p>
                  )}
                </div>
              )}

              {/* Выбор роли */}
              <fieldset className="space-y-2">
                <legend className="block text-xs font-medium text-[#111111]">Роль сотрудника</legend>
                <div className="grid grid-cols-2 gap-2">
                  {assignableRoles.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => form.setValue("role", value, { shouldValidate: true })}
                      className={cn(
                        "rounded-[8px] border px-3 py-2 text-left text-xs font-medium transition-colors cursor-pointer",
                        role === value
                          ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                          : "border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#fafafa]",
                      )}
                    >
                      {ROLE_LABELS[value]}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-[#888888]">{ROLE_HINTS[role]}</p>
              </fieldset>

              {willCostExtra && (
                <p className="flex items-start gap-2 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 text-xs text-[#666666]">
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
                className="h-8 rounded-[8px] border border-[#e5e5e5] px-4 text-[13px] font-medium text-[#666666] hover:bg-[#fafafa] hover:text-[#111111] transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={invite.isPending}
                className="flex items-center gap-2 h-8 rounded-[8px] bg-[#4a38f5] px-5 text-[13px] font-medium text-white hover:bg-[#3d2ee0] transition-colors cursor-pointer disabled:opacity-50"
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
