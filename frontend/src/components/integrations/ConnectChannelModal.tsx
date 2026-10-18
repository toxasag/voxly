"use client";

import { useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Plug } from "lucide-react";

import { ApiClientError } from "@/lib/api/apiClient";
import { useCreateChannelAccount } from "@/lib/api/use-channels";
import {
  createChannelAccountSchema,
  type CreateChannelAccountValues,
} from "@/schemas/channel.schema";
import { cn } from "@/lib/utils";
import type { ChannelSlug } from "@/types";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";

/**
 * Подсказка идентификатора зависит от канала: у Telegram это @username бота, у
 * WhatsApp — номер. Одно общее «Идентификатор» заставляло бы догадываться, что
 * вводить.
 */
const IDENTIFIER_HINTS: Record<ChannelSlug, { label: string; placeholder: string }> = {
  telegram: { label: "Имя бота или канала", placeholder: "@my_company_bot" },
  whatsapp: { label: "Номер телефона", placeholder: "+7 900 000-00-00" },
  max: { label: "Идентификатор бота MAX", placeholder: "@my_company" },
  avito: { label: "Идентификатор профиля Avito", placeholder: "12345678" },
  instagram: { label: "Имя аккаунта", placeholder: "@my_company" },
  webchat: { label: "Домен или название сайта", placeholder: "example.com" },
  telegram_bot: { label: "Username бота в Telegram", placeholder: "@my_company_bot" },
  max_bot: { label: "Идентификатор бота MAX", placeholder: "@my_company_bot" },
};

interface ConnectChannelModalProps {
  open: boolean;
  channel: ChannelSlug;
  channelName: string;
  onClose: () => void;
}

export function ConnectChannelModal({
  open,
  channel,
  channelName,
  onClose,
}: ConnectChannelModalProps) {
  const create = useCreateChannelAccount(channel);
  const hint = IDENTIFIER_HINTS[channel];

  const form = useForm<CreateChannelAccountValues>({
    resolver: zodResolver(createChannelAccountSchema),
    mode: "onChange",
    defaultValues: { label: "", external_id: "" },
  });

  useEffect(() => {
    if (open) form.reset({ label: "", external_id: "" });
  }, [open, form]);

  const submit = useCallback(
    async (values: CreateChannelAccountValues) => {
      try {
        await create.mutateAsync(values);
        toast.success(`${channelName}: подключение «${values.label}» добавлено`);
        onClose();
      } catch (error) {
        if (error instanceof ApiClientError) {
          if (error.code === "CHANNEL_ACCOUNT_EXISTS") {
            form.setError("external_id", { message: "Этот аккаунт уже подключён" });
            return;
          }

          if (error.isValidationError) {
            const fields = error.fieldErrors();
            if (fields.label !== undefined) form.setError("label", { message: fields.label });
            if (fields.external_id !== undefined) {
              form.setError("external_id", { message: fields.external_id });
            }
            return;
          }

          toast.error(error.message);
          return;
        }

        toast.error("Нет связи с сервером. Повторите попытку.");
      }
    },
    [create, channelName, onClose, form],
  );

  const errors = form.formState.errors;

  return (
    <Sheet open={open} onClose={onClose} width="w-[500px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[#4a38f5]/10">
            <Plug className="h-3.5 w-3.5 text-[#4a38f5]" />
          </div>
          <div>
            <h2 id="connect-channel-title" className="text-sm font-semibold text-[#111111]">
              Подключить {channelName}
            </h2>
            <p className="text-[11px] text-[#666666]">Авторизация выполняется после создания</p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent>
        <form onSubmit={form.handleSubmit((values) => void submit(values))} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="channel_label" className="block text-xs font-medium text-[#666666]">
              Название подключения
            </label>
            <input
              id="channel_label"
              autoFocus
              placeholder="Основной аккаунт"
              {...form.register("label")}
              className={cn(
                "h-8 w-full rounded-[4px] border bg-white px-2.5 text-xs text-[#111111] placeholder:text-[#888888]",
                "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                errors.label !== undefined ? "border-rose-500" : "border-[#e5e5e5]",
              )}
            />
            {errors.label && <p className="text-xs text-rose-500">{errors.label.message}</p>}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="channel_external_id" className="block text-xs font-medium text-[#666666]">
              {hint.label}
            </label>
            <input
              id="channel_external_id"
              placeholder={hint.placeholder}
              {...form.register("external_id")}
              className={cn(
                "h-8 w-full rounded-[4px] border bg-white px-2.5 text-xs text-[#111111] placeholder:text-[#888888]",
                "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                errors.external_id !== undefined ? "border-rose-500" : "border-[#e5e5e5]",
              )}
            />
            {errors.external_id && (
              <p className="text-xs text-rose-500">{errors.external_id.message}</p>
            )}
          </div>

          <p className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 text-xs leading-relaxed text-[#666666]">
            Подключение появится со статусом «Требуется авторизация». Обмен сообщениями
            заработает после подключения транспорта канала.
          </p>

          <div className="flex items-center justify-end gap-2 border-t border-[#e5e5e5] pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={create.isPending}
              className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#fafafa] disabled:opacity-40"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white transition-colors hover:bg-[#3b2be0] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {create.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Подключаем...
                </>
              ) : (
                "Подключить"
              )}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
