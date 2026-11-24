"use client";

import { useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Hash, Loader2, Pencil, ExternalLink, CheckCircle2 } from "lucide-react";

import { ApiClientError } from "@/lib/api/apiClient";
import {
  CHANNEL_STATUS_LABELS,
  useUpdateChannelAccount,
  type ChannelAccountDTO,
} from "@/lib/api/use-channels";
import { useAutoActivatePendingBot } from "@/lib/api/use-telegram-bot";
import { useAiAgents } from "@/lib/api/use-ai-agents";
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
  agent_id: z.string().nullable().optional(),
  token: z.string().trim().optional(),
});

type EditChannelAccountValues = z.infer<typeof editChannelAccountSchema>;

const STATUS_VARIANTS: Record<ChannelStatus, StatusBadgeVariant> = {
  connected: "success",
  pending: "warning",
  error: "destructive",
  disabled: "neutral",
};

/** Каналы, для которых отображается поле привязки AI-агента */
const AGENT_CHANNELS: ChannelSlug[] = ["telegram_bot", "telegram"];

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
  const autoActivate = useAutoActivatePendingBot();
  const { data: agents = [] } = useAiAgents();

  const showAgentField = AGENT_CHANNELS.includes(channel);

  const form = useForm<EditChannelAccountValues>({
    resolver: zodResolver(editChannelAccountSchema),
    mode: "onChange",
    defaultValues: {
      label: account?.label ?? "",
      agent_id: account?.boundAgentId ?? null,
      token: "",
    },
  });

  useEffect(() => {
    if (open && account) {
      form.reset({
        label: account.label,
        agent_id: account.boundAgentId ?? null,
        token: "",
      });
    }
  }, [open, account, form]);

  const handleQuickActivate = useCallback(async () => {
    if (!account) return;
    try {
      const updated = await autoActivate.mutateAsync({
        accountId: account.id,
        name: form.getValues("label") || account.label,
      });
      toast.success(`Бот ${updated.externalId} успешно активирован и подключен!`);
      onClose();
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : "Не удалось активировать бота";
      toast.error(msg);
    }
  }, [account, form, autoActivate, onClose]);

  const submit = useCallback(
    async (values: EditChannelAccountValues) => {
      if (!account) return;

      const trimmed = values.label.trim();
      const agentChanged = showAgentField && values.agent_id !== (account.boundAgentId ?? null);
      const labelChanged = trimmed !== account.label;
      const trimmedToken = values.token?.trim();
      const tokenChanged = Boolean(trimmedToken && trimmedToken.length > 5);

      if (!labelChanged && !agentChanged && !tokenChanged) {
        onClose();
        return;
      }

      try {
        await update.mutateAsync({
          id: account.id,
          label: trimmed,
          ...(showAgentField && { agent_id: values.agent_id ?? null }),
          ...(tokenChanged && { credentials: { token: trimmedToken } }),
        });
        toast.success(`Настройки подключения «${trimmed}» сохранены`);
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

        toast.error("Не удалось обновить настройки подключения");
      }
    },
    [account, update, onClose, form, showAgentField],
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

          {account.status === "pending" && (channel === "telegram_bot" || channel === "telegram") && (
            <div className="rounded-[8px] border border-amber-200 bg-amber-50/70 p-3.5 space-y-2.5">
              <div className="flex items-start gap-2">
                <ExternalLink className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-semibold text-amber-950">Ожидает создания в Telegram</p>
                  <p className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">
                    Для активации бота перейдите в Telegram и подтвердите создание, после чего бот автоматически подключится.
                  </p>
                </div>
              </div>
              <a
                href={`https://t.me/newbot/GetVoxlybot/${account.externalId.replace(/^@/, "")}?name=${encodeURIComponent(account.label)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-1.5 rounded-[6px] bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-2xs hover:bg-emerald-700"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Подтвердить создание в Telegram
              </a>
              <button
                type="button"
                onClick={() => void handleQuickActivate()}
                disabled={autoActivate.isPending}
                className="w-full flex items-center justify-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] hover:bg-[#fafafa] disabled:opacity-50"
              >
                {autoActivate.isPending ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Проверка...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    Проверить статус активации
                  </>
                )}
              </button>
            </div>
          )}

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

          {/* Поле обновления токена (для Telegram-каналов) */}
          {(channel === "telegram_bot" || channel === "telegram") && (
            <div className="space-y-1.5">
              <label htmlFor="edit_account_token" className="block text-xs font-medium text-[#666666]">
                Токен бота (@BotFather)
              </label>
              <input
                id="edit_account_token"
                type="password"
                autoComplete="off"
                placeholder="Вставьте новый токен бота, если меняли его"
                {...form.register("token")}
                disabled={isSubmitting}
                className={cn(
                  "h-8 w-full rounded-[4px] border bg-white px-2.5 text-xs font-mono text-[#111111] placeholder:text-[#888888]",
                  "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                  errors.token !== undefined ? "border-rose-500" : "border-[#e5e5e5]",
                )}
              />
              {errors.token ? (
                <p className="text-xs text-rose-500">{errors.token.message}</p>
              ) : (
                <p className="text-[11px] text-[#888888]">
                  Оставьте пустым, если токен не менялся
                </p>
              )}
            </div>
          )}

          {/* Поле привязки AI-агента (только для telegram-каналов) */}
          {showAgentField && (
            <div className="space-y-1.5">
              <label htmlFor="edit_account_agent" className="block text-xs font-medium text-[#666666]">
                Подключить AI-агент
              </label>
              <select
                id="edit_account_agent"
                {...form.register("agent_id")}
                disabled={isSubmitting}
                className="h-8 w-full rounded-[4px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 disabled:opacity-50"
              >
                <option value="">Без AI-агента</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.model})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-[#888888]">
                AI-агент будет автоматически отвечать на входящие сообщения в этом боте
              </p>
            </div>
          )}

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
