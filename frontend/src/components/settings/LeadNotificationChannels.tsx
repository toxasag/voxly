"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Mail,
  MessageSquare,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Skeleton } from "@/components/shared/Skeleton";
import { TagPill } from "@/components/ui/tag";
import { useOverlay } from "@/lib/utils/use-scroll-lock";
import {
  useCreateNotificationChannel,
  useDeleteNotificationChannel,
  useNotificationChannels,
  useSendTestNotification,
  useTelegramBindLink,
  useToggleNotificationChannel,
  type NotificationChannelDTO,
  type NotificationChannelType,
} from "@/lib/api/use-notification-channels";
import { useTenantInfo } from "@/lib/api/use-team";

const CHANNEL_CONFIG: Record<
  NotificationChannelType,
  {
    label: string;
    icon: typeof Mail;
    color: "sky" | "violet" | "emerald";
    antiBanBadge: string;
  }
> = {
  email: {
    label: "Email",
    icon: Mail,
    color: "sky",
    antiBanBadge: "Гарантированная доставка",
  },
  telegram: {
    label: "Telegram Bot",
    icon: Send,
    color: "violet",
    antiBanBadge: "100% защита от бана",
  },
  whatsapp: {
    label: "WhatsApp Gateway",
    icon: MessageSquare,
    color: "emerald",
    antiBanBadge: "Транзакционный шлюз",
  },
};

interface AddChannelModalProps {
  open: boolean;
  onClose: () => void;
  tenantId?: string;
}

function AddChannelModal({ open, onClose, tenantId }: AddChannelModalProps) {
  const [channelType, setChannelType] = useState<NotificationChannelType>("telegram");
  const [destination, setDestination] = useState("");
  const createMutation = useCreateNotificationChannel();
  const { data: bindLinkData } = useTelegramBindLink();

  useOverlay(open, { onEscape: onClose });

  if (!open) return null;

  const botUsername = bindLinkData?.bot_username || "GetVoxlybot";
  const deepLink =
    bindLinkData?.deep_link ||
    (tenantId ? `https://t.me/${botUsername}?start=bind_${tenantId}` : "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const cleanDest = destination.trim();
    if (!cleanDest && channelType !== "telegram") {
      toast.error("Укажите адрес или номер получателя");
      return;
    }

    if (channelType === "telegram" && !cleanDest && !deepLink) {
      toast.error("Подключите бота по ссылке или укажите Chat ID");
      return;
    }

    try {
      await createMutation.mutateAsync({
        channel_type: channelType,
        destination: cleanDest,
      });
      toast.success("Канал уведомлений успешно добавлен");
      setDestination("");
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Не удалось добавить канал";
      toast.error(msg);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-[16px] border border-[#e5e5e5] bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[#111111]">Добавить канал уведомлений</h2>
            <p className="mt-0.5 text-xs text-[#666666]">
              Получайте мгновенные оповещения о новых заявках клиентов
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] p-1.5 text-[#888888] hover:bg-[#fafafa] hover:text-[#111111] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Выбор типа канала */}
          <div>
            <label className="text-xs font-semibold text-[#111111] block mb-2">Тип канала</label>
            <div className="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => setChannelType("telegram")}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-[8px] border text-left transition-all ${
                  channelType === "telegram"
                    ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#4a38f5]"
                    : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc]"
                }`}
              >
                <Send className="h-5 w-5" />
                <span className="text-xs font-semibold">Telegram Bot</span>
                <span className="text-[10px] text-emerald-700 font-medium">100% антибан</span>
              </button>

              <button
                type="button"
                onClick={() => setChannelType("email")}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-[8px] border text-left transition-all ${
                  channelType === "email"
                    ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#4a38f5]"
                    : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc]"
                }`}
              >
                <Mail className="h-5 w-5" />
                <span className="text-xs font-semibold">Email</span>
                <span className="text-[10px] text-[#888888]">Дополнительный</span>
              </button>

              <button
                type="button"
                onClick={() => setChannelType("whatsapp")}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-[8px] border text-left transition-all ${
                  channelType === "whatsapp"
                    ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#4a38f5]"
                    : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc]"
                }`}
              >
                <MessageSquare className="h-5 w-5" />
                <span className="text-xs font-semibold">WhatsApp</span>
                <span className="text-[10px] text-emerald-700 font-medium">Шлюз Meta</span>
              </button>
            </div>
          </div>

          {/* Специфичные поля в зависимости от типа */}
          {channelType === "telegram" && (
            <div className="space-y-4">
              <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-3">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
                  <p className="text-xs text-[#444444] leading-relaxed">
                    Быстрое подключение: откройте официального бота в Telegram и нажмите кнопку{" "}
                    <strong>Start</strong>. Бот привяжется автоматически.
                  </p>
                </div>
                {deepLink && (
                  <a
                    href={deepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 w-full h-9 rounded-[8px] bg-[#4a38f5] text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0]"
                  >
                    <span>Подключить бота @{botUsername} в Telegram</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>

              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-[#e5e5e5]" />
                <span className="flex-shrink mx-3 text-[11px] text-[#888888]">
                  или укажите Chat ID вручную
                </span>
                <div className="flex-grow border-t border-[#e5e5e5]" />
              </div>

              <div>
                <label className="text-xs font-medium text-[#111111] block mb-1">
                  Telegram Chat ID или ID группы
                </label>
                <input
                  type="text"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="Например: 123456789 или -1001234567890"
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono"
                />
                <p className="mt-1 text-[11px] text-[#888888]">
                  Для корпоративных групп: добавьте бота в группу и укажите ID группы со знаком
                  минуса.
                </p>
              </div>
            </div>
          )}

          {channelType === "email" && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-[#111111] block mb-1">
                  Email-адрес для уведомлений
                </label>
                <input
                  type="email"
                  required
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="sales@company.ru или manager@mail.ru"
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>
              <p className="text-[11px] text-[#666666] leading-relaxed">
                Письмо отправляется сразу в момент квалификации лида или поступления контакта
                клиента из любого источника (виджет, чат, форма).
              </p>
            </div>
          )}

          {channelType === "whatsapp" && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-[#111111] block mb-1">
                  Номер телефона в международном формате
                </label>
                <input
                  type="tel"
                  required
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="+7 (915) 094-69-44"
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono"
                />
              </div>

              <div className="rounded-[8px] border border-emerald-200 bg-emerald-50/70 p-3 flex items-start gap-2.5">
                <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-700 mt-0.5" />
                <p className="text-[11px] text-emerald-950 leading-relaxed">
                  <strong>Антибан-гарантия:</strong> Уведомления транслируются через официальный
                  транзакционный шлюз GETVOXLY. Ваш личный номер не используется для исходящей
                  рассылки и полностью защищен от бана алгоритмами Meta.
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#e5e5e5]">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-medium text-[#444444] transition-colors hover:bg-[#fafafa]"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="h-8 rounded-[8px] bg-[#4a38f5] px-4 text-[13px] font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{createMutation.isPending ? "Добавление..." : "Добавить канал"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function LeadNotificationChannels() {
  const { data: channels, isLoading } = useNotificationChannels();
  const { data: info } = useTenantInfo();
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const deleteMutation = useDeleteNotificationChannel();
  const toggleMutation = useToggleNotificationChannel();
  const testMutation = useSendTestNotification();

  const handleTest = async (channel: NotificationChannelDTO) => {
    setTestingId(channel.id);
    try {
      const res = await testMutation.mutateAsync({ id: channel.id });
      if (res.delivered) {
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка отправки тестового уведомления";
      toast.error(msg);
    } finally {
      setTestingId(null);
    }
  };

  const handleToggle = async (channel: NotificationChannelDTO) => {
    try {
      await toggleMutation.mutateAsync({
        id: channel.id,
        isActive: !channel.is_active,
      });
      toast.success(
        channel.is_active ? "Канал временно отключен" : "Канал уведомлений активирован",
      );
    } catch {
      toast.error("Не удалось изменить статус канала");
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteMutation.mutateAsync(deleteId);
      toast.success("Канал уведомлений удален");
      setDeleteId(null);
    } catch {
      toast.error("Не удалось удалить канал");
    }
  };

  return (
    <div className="space-y-5">
      {/* Шапка блока */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[#111111]">
            Каналы уведомлений о заявках
          </h2>
          <p className="mt-0.5 text-xs text-[#666666]">
            Куда отправлять оповещения при поступлении новых лидов и контактов клиентов
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddModalOpen(true)}
          className="inline-flex items-center gap-1.5 h-8 rounded-[8px] bg-[#4a38f5] px-3.5 text-[13px] font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          <span>Добавить канал</span>
        </button>
      </div>

      {/* Антибан-информационный баннер */}
      <div className="rounded-[8px] border border-emerald-200 bg-emerald-50/70 p-4 flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-700 mt-0.5" />
        <div className="space-y-1 text-xs">
          <p className="font-semibold text-emerald-950">
            Антибан-архитектура GETVOXLY активна
          </p>
          <p className="text-emerald-900 leading-relaxed">
            В отличие от серых web-сессий WhatsApp и личных user-ботов Telegram, платформа использует
            официальный Bot API платформы и верифицированный транзакционный шлюз. Ваши личные номера и
            аккаунты полностью защищены от блокировок алгоритмами Meta и Telegram.
          </p>
        </div>
      </div>

      {/* Таблица / список каналов */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white overflow-hidden shadow-2xs">
        {isLoading ? (
          <div className="p-5 space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : channels && channels.length > 0 ? (
          <div className="divide-y divide-[#f0f0f0]">
            {channels.map((channel) => {
              const cfg = CHANNEL_CONFIG[channel.channel_type] ?? CHANNEL_CONFIG.email;
              const Icon = cfg.icon;

              return (
                <div
                  key={channel.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-3 hover:bg-[#fafafa] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[#f5f5f5]">
                      <Icon className="h-4 w-4 text-[#4a38f5]" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <TagPill color={cfg.color}>{cfg.label}</TagPill>
                        {(() => {
                          const meta = (channel.extra_meta as Record<string, unknown>) ?? {};
                          const tgUsername = meta.username ? `@${meta.username}` : null;
                          const metaName = meta.name ? String(meta.name) : null;
                          const isAutoLinked = Boolean(meta.auto_linked);
                          return (
                            <>
                              {tgUsername ? (
                                <span className="font-semibold text-[13px] text-[#111111]">
                                  {tgUsername}
                                </span>
                              ) : metaName ? (
                                <span className="font-semibold text-[13px] text-[#111111]">
                                  {metaName}
                                </span>
                              ) : null}
                              <span className="font-mono text-xs text-[#666666] bg-[#f5f5f5] px-1.5 py-0.5 rounded-[4px]">
                                {channel.channel_type === "telegram" ? `ID: ${channel.destination}` : channel.destination}
                              </span>
                              {isAutoLinked && (
                                <span className="text-[10px] text-violet-700 font-medium bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded-[4px]">
                                  Аккаунт владельца
                                </span>
                              )}
                            </>
                          );
                        })()}
                        <span className="text-[10px] text-emerald-700 font-medium bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-[4px]">
                          {cfg.antiBanBadge}
                        </span>
                      </div>

                      <div className="mt-1 flex items-center gap-3 text-[11px] text-[#666666]">
                        <span className="flex items-center gap-1">
                          {channel.is_active ? (
                            <>
                              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                              <span className="text-emerald-700">Активен</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="h-3 w-3 text-[#888888]" />
                              <span className="text-[#888888]">Отключен</span>
                            </>
                          )}
                        </span>
                        <span>•</span>
                        <span>Добавлен: {new Date(channel.created_at).toLocaleDateString("ru-RU")}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                    <button
                      type="button"
                      disabled={testingId === channel.id || !channel.is_active}
                      onClick={() => handleTest(channel)}
                      className="h-7 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#111111] transition-colors hover:bg-[#f5f5f5] hover:border-[#cccccc] disabled:opacity-40 inline-flex items-center gap-1"
                    >
                      {testingId === channel.id && <Loader2 className="h-3 w-3 animate-spin" />}
                      <span>Тест</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggle(channel)}
                      className={`h-7 rounded-[6px] border px-2.5 text-xs font-medium transition-colors ${
                        channel.is_active
                          ? "border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#f5f5f5]"
                          : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                      }`}
                    >
                      {channel.is_active ? "Отключить" : "Включить"}
                    </button>

                    <button
                      type="button"
                      onClick={() => setDeleteId(channel.id)}
                      className="h-7 w-7 rounded-[6px] border border-rose-200 bg-rose-50 text-rose-600 transition-colors hover:bg-rose-100 flex items-center justify-center"
                      title="Удалить канал"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-8 text-center space-y-3">
            <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-full bg-[#f5f5f5] text-[#888888]">
              <Send className="h-6 w-6 text-[#4a38f5]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[#111111]">
                Каналы уведомлений ещё не настроены
              </p>
              <p className="mt-1 text-xs text-[#666666] max-w-md mx-auto">
                По умолчанию все заявки отправляются на основной email аккаунта. Добавьте Telegram-бота
                или WhatsApp, чтобы сотрудники получали уведомления о заявках прямо в мессенджеры без задержек.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAddModalOpen(true)}
              className="inline-flex items-center gap-1.5 h-8 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Подключить первый канал</span>
            </button>
          </div>
        )}
      </div>

      <AddChannelModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        tenantId={info?.id}
      />

      <ConfirmDialog
        open={Boolean(deleteId)}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Удалить канал уведомлений?"
        description="Оповещения о новых заявках больше не будут приходить по этому адресу."
        confirmLabel="Удалить"
        variant="destructive"
        isPending={deleteMutation.isPending}
      />
    </div>
  );
}
