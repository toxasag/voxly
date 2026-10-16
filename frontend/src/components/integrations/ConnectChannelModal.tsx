"use client";

import { useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Plug, X } from "lucide-react";

import { ApiClientError } from "@/lib/api/apiClient";
import { useCreateChannelAccount } from "@/lib/api/use-channels";
import {
  createChannelAccountSchema,
  type CreateChannelAccountValues,
} from "@/schemas/channel.schema";
import { cn } from "@/lib/utils";
import type { ChannelSlug } from "@/types";
import { useOverlay } from "@/lib/utils/use-scroll-lock";

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

  // Единый стек оверлеев. Закрывает два дефекта разом: прямая правка
  // `body.style.overflow` возвращала прокрутку фону при закрытии верхнего из
  // нескольких оверлеев, а собственный слушатель Escape закрывал их все сразу.
  useOverlay(open, { onEscape: onClose, disabled: create.isPending });

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
          // Лимит тарифа и повтор аккаунта — ожидаемые отказы, а не сбой:
          // сообщение сервера уже объясняет, что делать.
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

  const backdrop = useCallback(
    (event: React.MouseEvent) => {
      if (event.target === event.currentTarget && !create.isPending) onClose();
    },
    [onClose, create.isPending],
  );

  if (!open) return null;

  const errors = form.formState.errors;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-channel-title"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10">
              <Plug className="h-4 w-4 text-amber-400" />
            </div>
            <div>
              <h2 id="connect-channel-title" className="text-sm font-semibold text-slate-100">
                Подключить аккаунт {channelName}
              </h2>
              <p className="text-xs text-slate-500">Авторизация выполняется после создания</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={create.isPending}
            aria-label="Закрыть"
            className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={form.handleSubmit((values) => void submit(values))} className="space-y-4 p-6">
          <div className="space-y-2">
            <label htmlFor="channel_label" className="block text-xs font-medium text-slate-400">
              Название подключения
            </label>
            <input
              id="channel_label"
              autoFocus
              placeholder="Основной аккаунт"
              {...form.register("label")}
              className={cn(
                "w-full rounded-lg border bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500",
                "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                errors.label !== undefined ? "border-rose-500" : "border-slate-700",
              )}
            />
            {errors.label && <p className="text-xs text-rose-400">{errors.label.message}</p>}
          </div>

          <div className="space-y-2">
            <label htmlFor="channel_external_id" className="block text-xs font-medium text-slate-400">
              {hint.label}
            </label>
            <input
              id="channel_external_id"
              placeholder={hint.placeholder}
              {...form.register("external_id")}
              className={cn(
                "w-full rounded-lg border bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500",
                "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                errors.external_id !== undefined ? "border-rose-500" : "border-slate-700",
              )}
            />
            {errors.external_id && (
              <p className="text-xs text-rose-400">{errors.external_id.message}</p>
            )}
          </div>

          <p className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs leading-relaxed text-slate-500">
            Подключение появится со статусом «Требуется авторизация». Обмен сообщениями
            заработает после подключения транспорта канала — он в разработке.
          </p>

          <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={create.isPending}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {create.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Подключаем...
                </>
              ) : (
                "Подключить"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
