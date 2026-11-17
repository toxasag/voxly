"use client";

import { useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Hash, Loader2, Pencil } from "lucide-react";

import { ApiClientError } from "@/lib/api/apiClient";
import {
  CHANNEL_STATUS_LABELS,
  useUpdateChannelAccount,
  type ChannelAccountDTO,
} from "@/lib/api/use-channels";
import { StatusBadge, type StatusBadgeVariant } from "@/components/shared/StatusBadge";
import { Sheet, SheetContent, SheetHeader } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { ChannelStatus } from "@/schemas/channel.schema";
import type { ChannelSlug } from "@/types";

const editChannelAccountSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Укажите название подключения")
    .max(120, "Название не может быть длиннее 120 символов"),
});

type EditChannelAccountValues = z.infer<typeof editChannelAccountSchema>;

const STATUS_VARIANTS: Record<ChannelStatus, StatusBadgeVariant> = {
  connected: "success",
  pending: "warning",
  error: "destructive",
  disabled: "neutral",
};

interface EditChannelAccountModalProps {
  open: boolean;
  channel: ChannelSlug;
  channelName: string;
  account: ChannelAccountDTO | null;
  onClose: () => void;
}

export function EditChannelAccountModal({
  open,
  channel,
  channelName,
  account,
  onClose,
}: EditChannelAccountModalProps) {
  const update = useUpdateChannelAccount(channel);

  const form = useForm<EditChannelAccountValues>({
    resolver: zodResolver(editChannelAccountSchema),
    mode: "onChange",
    defaultValues: { label: account?.label ?? "" },
  });

  useEffect(() => {
    if (open && account) {
      form.reset({ label: account.label });
    }
  }, [open, account, form]);

  const submit = useCallback(
    async (values: EditChannelAccountValues) => {
      if (!account) return;

      const trimmed = values.label.trim();
      if (trimmed === account.label) {
        onClose();
        return;
      }

      try {
        await update.mutateAsync({
          id: account.id,
          label: trimmed,
        });
        toast.success(`Название подключения изменено на «${trimmed}»`);
        onClose();
      } catch (error) {
        if (error instanceof ApiClientError) {
          if (error.isValidationError) {
            const fields = error.fieldErrors();
            if (fields.label !== undefined) {
              form.setError("label", { message: fields.label });
              return;
            }
          }
          toast.error(error.message);
          return;
        }

        toast.error("Не удалось обновить название подключения");
      }
    },
    [account, update, onClose, form],
  );

  if (!account) return null;

  const errors = form.formState.errors;
  const isSubmitting = update.isPending;

  return (
    <Sheet open={open} onClose={onClose} width="w-[480px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[#4a38f5]/10">
            <Pencil className="h-3.5 w-3.5 text-[#4a38f5]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">
              Редактировать подключение
            </h2>
            <p className="text-[11px] text-[#666666]">
              Канал {channelName}
            </p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="p-6">
        <form onSubmit={form.handleSubmit((values) => void submit(values))} className="space-y-5">
          {/* Блок с неизменяемыми метаданными для контекста */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#666666]">Текущий статус</span>
              <StatusBadge variant={STATUS_VARIANTS[account.status] ?? "neutral"} size="sm">
                {CHANNEL_STATUS_LABELS[account.status] ?? account.status}
              </StatusBadge>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1 text-[#666666]">
                <Hash className="h-3 w-3 text-[#888888]" />
                Идентификатор
              </span>
              <span className="font-mono text-[11px] font-medium text-[#111111]">
                {account.externalId}
              </span>
            </div>
          </div>

          {/* Поле редактирования названия */}
          <div className="space-y-1.5">
            <label htmlFor="edit_account_label" className="block text-xs font-medium text-[#666666]">
              Название подключения
            </label>
            <input
              id="edit_account_label"
              autoFocus
              placeholder="Например: Основной, Отдел продаж"
              {...form.register("label")}
              disabled={isSubmitting}
              className={cn(
                "h-8 w-full rounded-[4px] border bg-white px-2.5 text-xs text-[#111111] placeholder:text-[#888888]",
                "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                errors.label !== undefined ? "border-rose-500" : "border-[#e5e5e5]",
              )}
            />
            {errors.label ? (
              <p className="text-xs text-rose-500">{errors.label.message}</p>
            ) : (
              <p className="text-[11px] text-[#888888]">
                Отображается в списках чатов, сделках и фильтрах
              </p>
            )}
          </div>

          {/* Кнопки действий */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] disabled:opacity-50"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !form.formState.isValid}
              className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 text-xs font-medium text-white shadow-2xs hover:bg-[#3d2ee0] disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Сохранение...
                </>
              ) : (
                "Сохранить"
              )}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
