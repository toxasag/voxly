"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FileText,
  Layers,
  Loader2,
  Mail,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Skeleton } from "@/components/shared/Skeleton";
import { Switch } from "@/components/ui/switch";
import { TagPill } from "@/components/ui/tag";
import { useOverlay } from "@/lib/utils/use-scroll-lock";
import {
  useCreateNotificationChannel,
  useDeleteNotificationChannel,
  useNotificationChannels,
  useSendTestNotification,
  useTelegramBindLink,
  useToggleNotificationChannel,
  useUpdateNotificationChannel,
  type NotificationChannelDTO,
  type NotificationChannelType,
} from "@/lib/api/use-notification-channels";
import {
  useBitrix24Config,
  useBitrix24Logs,
  useTenantWidgets,
  useTestBitrix24Connection,
  useUpdateBitrix24Config,
  type LeadSource,
} from "@/lib/api/use-bitrix24";
import { useTenantInfo } from "@/lib/api/use-team";
import { SourceMultiSelect, SOURCE_MAP } from "@/components/settings/SourceMultiSelect";
import { WidgetMultiSelect } from "@/components/settings/WidgetMultiSelect";
import { Bitrix24SyncLogTable } from "@/components/settings/Bitrix24SyncLogTable";

type ExtendedChannelType = NotificationChannelType;

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
  bitrix24: {
    label: "Битрикс24",
    icon: Layers,
    color: "sky",
    antiBanBadge: "crm.lead.add REST API",
  },
};

function getBitrixDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 30);
  }
}

interface AddChannelModalProps {
  open: boolean;
  onClose: () => void;
  tenantId?: string;
  initialType?: ExtendedChannelType;
  initialTab?: "settings" | "logs";
  editingChannel?: NotificationChannelDTO | null;
  onSelectDeal?: (dealId: string) => void;
}

function AddChannelModal({
  open,
  onClose,
  tenantId,
  initialType = "telegram",
  initialTab = "settings",
  editingChannel,
  onSelectDeal,
}: AddChannelModalProps) {
  const [channelType, setChannelType] = useState<ExtendedChannelType>(initialType);
  const [activeTab, setActiveTab] = useState<"settings" | "logs">(initialTab);
  const [destination, setDestination] = useState("");
  const createMutation = useCreateNotificationChannel();
  const updateChannelMutation = useUpdateNotificationChannel();
  const { data: bindLinkData } = useTelegramBindLink();

  // Битрикс24 стейт
  const { data: bitrixConfig } = useBitrix24Config();
  const { data: widgets = [], isLoading: widgetsLoading } = useTenantWidgets();
  const { data: logsData } = useBitrix24Logs({ limit: 1 });
  const updateBitrixMutation = useUpdateBitrix24Config();
  const testBitrixMutation = useTestBitrix24Connection();

  const logsTotalCount = typeof logsData?.total === "number"
    ? logsData.total
    : Array.isArray(logsData)
      ? logsData.length
      : Array.isArray(logsData?.logs)
        ? logsData.logs.length
        : 0;

  const [bitrixUrl, setBitrixUrl] = useState("");
  const [bitrixEnabled, setBitrixEnabled] = useState(true);
  const [bitrixAllowedSources, setBitrixAllowedSources] = useState<LeadSource[]>([]);
  const [bitrixSelectedWidgetIds, setBitrixSelectedWidgetIds] = useState<string[]>([]);
  const [bitrixCustomSourceId, setBitrixCustomSourceId] = useState("UC_VWN1ZK");
  const [bitrixSendUtmMarks, setBitrixSendUtmMarks] = useState(true);
  const [bitrixSendGeoData, setBitrixSendGeoData] = useState(true);
  const [bitrixTestStatus, setBitrixTestStatus] = useState<{
    success: boolean;
    leadId?: number | string;
    message: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (open) {
      if (editingChannel) {
        setChannelType(editingChannel.channel_type);
        setActiveTab(initialTab);
        if (editingChannel.channel_type === "bitrix24") {
          const meta = (editingChannel.extra_meta as Record<string, unknown>) ?? {};
          setBitrixUrl(editingChannel.destination || "");
          setBitrixEnabled(editingChannel.is_active);
          setBitrixAllowedSources(Array.isArray(meta.allowed_sources) ? (meta.allowed_sources as LeadSource[]) : []);
          setBitrixSelectedWidgetIds(Array.isArray(meta.selected_widget_ids) ? (meta.selected_widget_ids as string[]) : []);
          setBitrixCustomSourceId(typeof meta.custom_source_id === "string" && meta.custom_source_id ? meta.custom_source_id : "UC_VWN1ZK");
          setBitrixSendUtmMarks(meta.send_utm_marks !== false);
          setBitrixSendGeoData(meta.send_geo_data !== false);
        } else {
          setDestination(editingChannel.destination || "");
        }
      } else {
        setChannelType(initialType);
        setActiveTab(initialTab);
        setDestination("");
        if (initialType === "bitrix24") {
          setBitrixUrl("");
          setBitrixEnabled(true);
          setBitrixAllowedSources([]);
          setBitrixSelectedWidgetIds([]);
          setBitrixCustomSourceId("UC_VWN1ZK");
          setBitrixSendUtmMarks(true);
          setBitrixSendGeoData(true);
        } else if (bitrixConfig) {
          setBitrixUrl(bitrixConfig.webhook_url || "");
          setBitrixEnabled(bitrixConfig.webhook_url ? Boolean(bitrixConfig.is_enabled) : true);
          setBitrixAllowedSources(bitrixConfig.allowed_sources ?? []);
          setBitrixSelectedWidgetIds(bitrixConfig.selected_widget_ids ?? []);
          setBitrixCustomSourceId(bitrixConfig.custom_source_id || "UC_VWN1ZK");
          setBitrixSendUtmMarks(bitrixConfig.send_utm_marks ?? true);
          setBitrixSendGeoData(bitrixConfig.send_geo_data ?? true);
        }
      }
      setBitrixTestStatus(null);
    }
  }, [open, initialType, initialTab, editingChannel, bitrixConfig]);

  useOverlay(open, { onEscape: onClose });

  if (!open) return null;

  const botUsername = bindLinkData?.bot_username || "GetVoxlybot";
  const deepLink =
    bindLinkData?.deep_link ||
    (tenantId ? `https://t.me/${botUsername}?start=bind_${tenantId}` : "");

  const handleTestBitrix = async () => {
    const cleanUrl = bitrixUrl.trim();
    if (!cleanUrl) {
      toast.error("Укажите URL входящего вебхука Битрикс24");
      return;
    }
    setBitrixTestStatus(null);
    try {
      const res = await testBitrixMutation.mutateAsync({ webhook_url: cleanUrl });
      setBitrixTestStatus(res);
      if (res.success) {
        toast.success(res.message);
      } else {
        const msg = res.message || res.error || "Ошибка проверки вебхука";
        setBitrixTestStatus({ success: false, message: msg, error: msg });
        toast.error(msg);
      }
    } catch (err: unknown) {
      const anyErr = err as {
        message?: string;
        details?: Record<string, string[]> | string;
        data?: { message?: string; details?: string; error?: string };
        error?: { message?: string };
      };
      const msg =
        (typeof anyErr.details === "string" && anyErr.details) ||
        anyErr.data?.details ||
        anyErr.data?.message ||
        anyErr.data?.error ||
        anyErr.error?.message ||
        anyErr.message ||
        "Ошибка проверки вебхука";
      setBitrixTestStatus({ success: false, message: msg, error: msg });
      toast.error(msg);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (channelType === "bitrix24") {
      const cleanUrl = bitrixUrl.trim();
      if (!cleanUrl) {
        toast.error("Укажите URL входящего вебхука Битрикс24");
        return;
      }
      try {
        const extraMeta = {
          allowed_sources: bitrixAllowedSources,
          selected_widget_ids: bitrixSelectedWidgetIds,
          custom_source_id: bitrixCustomSourceId.trim() || "UC_VWN1ZK",
          send_utm_marks: bitrixSendUtmMarks,
          send_geo_data: bitrixSendGeoData,
        };

        if (editingChannel && editingChannel.channel_type === "bitrix24") {
          await updateChannelMutation.mutateAsync({
            id: editingChannel.id,
            destination: cleanUrl,
            extra_meta: extraMeta,
            is_active: bitrixEnabled,
          });
          toast.success("Канал Битрикс24 успешно обновлен");
        } else {
          await createMutation.mutateAsync({
            channel_type: "bitrix24",
            destination: cleanUrl,
            extra_meta: extraMeta,
            is_active: bitrixEnabled,
          });
          toast.success("Новый канал Битрикс24 успешно добавлен");
        }
        onClose();
      } catch (err: unknown) {
        const anyErr = err as { data?: { message?: string; details?: string }; message?: string };
        const msg = anyErr.data?.details || anyErr.data?.message || anyErr.message || "Не удалось сохранить Битрикс24";
        toast.error(msg);
      }
      return;
    }

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
      if (editingChannel) {
        await updateChannelMutation.mutateAsync({
          id: editingChannel.id,
          destination: cleanDest,
        });
        toast.success("Канал уведомлений успешно обновлен");
      } else {
        await createMutation.mutateAsync({
          channel_type: channelType,
          destination: cleanDest,
        });
        toast.success("Канал уведомлений успешно добавлен");
      }
      setDestination("");
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Не удалось сохранить канал";
      toast.error(msg);
    }
  };

  const isSaving = createMutation.isPending || updateBitrixMutation.isPending || updateChannelMutation.isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[92vh] md:max-h-[88vh] rounded-[16px] border border-[#e5e5e5] bg-white shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка модального окна — фиксированная */}
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-6 py-3.5 bg-white flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-[#111111]">
              {editingChannel
                ? editingChannel.channel_type === "bitrix24"
                  ? "Настройки канала Битрикс24"
                  : `Редактировать канал: ${CHANNEL_CONFIG[editingChannel.channel_type]?.label || editingChannel.channel_type}`
                : channelType === "bitrix24"
                ? "Добавить канал Битрикс24"
                : "Добавить канал передачи заявок"}
            </h2>
            <p className="mt-0.5 text-xs text-[#666666]">
              {channelType === "bitrix24"
                ? "Автоматический экспорт лидов через вебхук CRM и журнал синхронизаций"
                : "Получайте мгновенные оповещения о новых заявках в мессенджеры или передавайте лиды в CRM"}
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

        {/* Табы режима только для Битрикс24 */}
        {channelType === "bitrix24" && (
          <div className="flex items-center gap-1 border-b border-[#e5e5e5] px-6 bg-[#fbfbfb] flex-shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab("settings")}
              className={`py-2 px-3 text-xs font-medium border-b-2 transition-all ${
                activeTab === "settings"
                  ? "border-[#4a38f5] text-[#4a38f5] font-semibold"
                  : "border-transparent text-[#666666] hover:text-[#111111]"
              }`}
            >
              Настройки экспорта
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("logs")}
              className={`py-2 px-3 text-xs font-medium border-b-2 transition-all flex items-center gap-1.5 ${
                activeTab === "logs"
                  ? "border-[#4a38f5] text-[#4a38f5] font-semibold"
                  : "border-transparent text-[#666666] hover:text-[#111111]"
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Журнал отправок</span>
              {logsTotalCount > 0 && (
                <span className="text-[10px] bg-[#4a38f5]/10 text-[#4a38f5] px-1.5 py-0.2 rounded-full font-mono font-semibold">
                  {logsTotalCount}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Скроллируемая область контента */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {channelType === "bitrix24" && activeTab === "logs" ? (
            <Bitrix24SyncLogTable onSelectDeal={onSelectDeal} />
          ) : (
            <form id="add-channel-form" onSubmit={handleSubmit} className="space-y-5">
          {/* Выбор типа канала — 4 провайдера (скрываем при редактировании существующего канала) */}
          {!editingChannel && (
            <div>
              <label className="text-xs font-semibold text-[#111111] block mb-2">Тип канала</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
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

                <button
                  type="button"
                  onClick={() => setChannelType("bitrix24")}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-[8px] border text-left transition-all ${
                    channelType === "bitrix24"
                      ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#4a38f5]"
                      : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc]"
                  }`}
                >
                  <Layers className="h-5 w-5 text-[#4a38f5]" />
                  <span className="text-xs font-semibold">Битрикс24</span>
                  <span className="text-[10px] text-sky-700 font-medium bg-sky-50 px-1 rounded">Вебхук CRM</span>
                </button>
              </div>
            </div>
          )}

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

          {channelType === "bitrix24" && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-[#111111] block mb-1">
                  URL входящего вебхука Битрикс24 (crm.lead.add)
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    required
                    value={bitrixUrl}
                    onChange={(e) => setBitrixUrl(e.target.value)}
                    placeholder="https://domain.bitrix24.ru/rest/1/webhook_code/crm.lead.add.json"
                    className="flex-1 h-9 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleTestBitrix}
                    disabled={testBitrixMutation.isPending || !bitrixUrl.trim()}
                    className="h-9 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] transition-colors hover:bg-[#f5f5f5] hover:border-[#cccccc] disabled:opacity-40 inline-flex items-center gap-1 shrink-0"
                  >
                    {testBitrixMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 text-[#666666]" />
                    )}
                    <span>Тест</span>
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-[#666666]">
                  В Битрикс24: <strong>Разработчикам → Другое → Входящий вебхук</strong> (требуются права CRM).
                </p>
              </div>

              <div className="flex items-center justify-between p-3 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa]">
                <div className="space-y-0.5">
                  <span className="text-xs font-medium text-[#111111] block">
                    Активировать экспорт лидов
                  </span>
                  <span className="text-[11px] text-[#666666] block">
                    Отправлять заявки сразу при поступлении
                  </span>
                </div>
                <Switch checked={bitrixEnabled} onCheckedChange={setBitrixEnabled} />
              </div>

              {/* Мультивыбор источников заявок */}
              <div className="p-3 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa]/50 space-y-3">
                <SourceMultiSelect
                  value={bitrixAllowedSources}
                  onChange={setBitrixAllowedSources}
                  disabled={updateBitrixMutation.isPending}
                />

                {(bitrixAllowedSources.length === 0 || bitrixAllowedSources.includes("site_widget")) && (
                  <div className="pt-2 border-t border-[#e5e5e5]">
                    <WidgetMultiSelect
                      widgets={widgets}
                      selectedIds={bitrixSelectedWidgetIds}
                      onChange={setBitrixSelectedWidgetIds}
                      disabled={updateBitrixMutation.isPending}
                      isLoading={widgetsLoading}
                    />
                  </div>
                )}
              </div>

              {/* Поле SOURCE_ID */}
              <div>
                <label className="text-xs font-medium text-[#111111] block mb-1">
                  Идентификатор источника (SOURCE_ID)
                </label>
                <input
                  type="text"
                  value={bitrixCustomSourceId}
                  onChange={(e) => setBitrixCustomSourceId(e.target.value)}
                  placeholder="UC_VWN1ZK (или WIDGET, WEB, CALL)"
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono"
                />
                <p className="mt-1 text-[11px] text-[#666666]">
                  Код источника из справочника CRM Битрикс24. По умолчанию: <code className="bg-[#f0f0f0] px-1 rounded font-mono text-[#111111]">UC_VWN1ZK</code>.
                </p>
              </div>

              {/* Опции обогащения */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="flex items-center justify-between p-2.5 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa]">
                  <div className="pr-2">
                    <span className="font-medium text-[#111111] block">UTM-метки</span>
                    <span className="text-[10px] text-[#666666] block">Нативные поля Битрикс24</span>
                  </div>
                  <Switch checked={bitrixSendUtmMarks} onCheckedChange={setBitrixSendUtmMarks} />
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa]">
                  <div className="pr-2">
                    <span className="font-medium text-[#111111] block">Гео и метаданные</span>
                    <span className="text-[10px] text-[#666666] block">Город, IP, устройство в комментарий</span>
                  </div>
                  <Switch checked={bitrixSendGeoData} onCheckedChange={setBitrixSendGeoData} />
                </div>
              </div>

              {bitrixTestStatus && (
                <div
                  className={`rounded-[8px] p-3 text-xs border flex items-start gap-2.5 ${
                    bitrixTestStatus.success
                      ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                      : "bg-rose-50 border-rose-200 text-rose-900"
                  }`}
                >
                  {bitrixTestStatus.success ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
                  )}
                  <div>
                    <p className="font-semibold">{bitrixTestStatus.message}</p>
                    {bitrixTestStatus.success && bitrixTestStatus.leadId && (
                      <p className="text-[11px] text-emerald-700 mt-0.5">
                        Создан тестовый лид ID: {bitrixTestStatus.leadId} с SOURCE_ID = {bitrixCustomSourceId.trim() || "UC_VWN1ZK"}.
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 space-y-1.5 text-[11px] text-[#555555]">
                <p className="font-semibold text-[#111111] flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#4a38f5]" />
                  <span>Правила полезной нагрузки лида:</span>
                </p>
                <p>• Источник: <code className="bg-[#f0f0f0] px-1 rounded font-mono text-[#111111]">SOURCE_ID = {bitrixCustomSourceId.trim() || "UC_VWN1ZK"}</code></p>
                <p>• Метрика: передача Client ID Яндекс.Метрики в поле <code className="bg-[#f0f0f0] px-1 rounded font-mono text-[#111111]">UF_CRM_YA_CID</code></p>
                <p>• Контакты: имя, телефон (WORK), email, суть обращения и UTM-метки</p>
              </div>
            </div>
          )}

            </form>
          )}
        </div>

        {/* Футер модального окна — фиксированный внизу */}
        <div className="flex items-center justify-between border-t border-[#e5e5e5] px-6 py-3.5 bg-white flex-shrink-0">
          <div>
            {channelType === "bitrix24" && activeTab === "settings" && (
              <button
                type="button"
                onClick={handleTestBitrix}
                disabled={testBitrixMutation.isPending || !bitrixUrl.trim()}
                className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] transition-colors hover:bg-[#f5f5f5] hover:border-[#cccccc] disabled:opacity-40 inline-flex items-center gap-1.5"
              >
                {testBitrixMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 text-[#666666]" />
                )}
                <span>Проверить вебхук (Тест)</span>
              </button>
            )}
            {channelType === "bitrix24" && activeTab === "logs" && (
              <button
                type="button"
                onClick={() => setActiveTab("settings")}
                className="text-xs text-[#4a38f5] hover:underline inline-flex items-center gap-1 font-medium"
              >
                ← К настройкам экспорта
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 text-xs font-medium text-[#444444] transition-colors hover:bg-[#fafafa]"
            >
              {activeTab === "logs" ? "Закрыть" : "Отмена"}
            </button>
            {activeTab === "settings" && (
              <button
                type="submit"
                form="add-channel-form"
                disabled={isSaving}
                className="h-8 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>
                  {isSaving
                    ? "Сохранение..."
                    : editingChannel
                    ? "Сохранить изменения"
                    : channelType === "bitrix24"
                    ? "Добавить канал Битрикс24"
                    : "Добавить канал"}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LeadNotificationChannels() {
  const { data: channels, isLoading } = useNotificationChannels();
  const { data: info } = useTenantInfo();
  const { data: bitrixConfig, isLoading: bitrixLoading } = useBitrix24Config();
  const updateBitrixMutation = useUpdateBitrix24Config();
  const testBitrixMutation = useTestBitrix24Connection();

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<NotificationChannelDTO | null>(null);
  const [modalInitialType, setModalInitialType] = useState<ExtendedChannelType>("telegram");
  const [modalInitialTab, setModalInitialTab] = useState<"settings" | "logs">(
    "settings",
  );
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isDeletingBitrix, setIsDeletingBitrix] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testingBitrix, setTestingBitrix] = useState(false);

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

  const handleTestBitrix = async () => {
    if (!bitrixConfig?.webhook_url) {
      toast.error("Битрикс24 не настроен");
      return;
    }
    setTestingBitrix(true);
    try {
      const res = await testBitrixMutation.mutateAsync({ webhook_url: bitrixConfig.webhook_url });
      if (res.success) {
        toast.success(res.message);
      } else {
        const msg = res.message || res.error || "Ошибка проверки Битрикс24";
        toast.error(msg);
      }
    } catch (err: unknown) {
      const anyErr = err as {
        message?: string;
        details?: Record<string, string[]> | string;
        data?: { message?: string; details?: string; error?: string };
        error?: { message?: string };
      };
      const msg =
        (typeof anyErr.details === "string" && anyErr.details) ||
        anyErr.data?.details ||
        anyErr.data?.message ||
        anyErr.data?.error ||
        anyErr.error?.message ||
        anyErr.message ||
        "Ошибка проверки Битрикс24";
      toast.error(msg);
    } finally {
      setTestingBitrix(false);
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

  const handleToggleBitrix = async () => {
    if (!bitrixConfig?.webhook_url) return;
    try {
      await updateBitrixMutation.mutateAsync({
        webhook_url: bitrixConfig.webhook_url,
        is_enabled: !bitrixConfig.is_enabled,
      });
      toast.success(
        bitrixConfig.is_enabled
          ? "Экспорт в Битрикс24 временно приостановлен"
          : "Экспорт в Битрикс24 активирован",
      );
    } catch {
      toast.error("Не удалось изменить статус Битрикс24");
    }
  };

  const handleDelete = async () => {
    if (isDeletingBitrix) {
      try {
        await updateBitrixMutation.mutateAsync({
          webhook_url: "",
          is_enabled: false,
        });
        toast.success("Интеграция с Битрикс24 отключена");
      } catch {
        toast.error("Не удалось отключить Битрикс24");
      } finally {
        setIsDeletingBitrix(false);
      }
      return;
    }

    if (!deleteId) return;
    try {
      await deleteMutation.mutateAsync(deleteId);
      toast.success("Канал уведомлений удален");
      setDeleteId(null);
    } catch {
      toast.error("Не удалось удалить канал");
    }
  };

  const hasB24InChannels = Boolean(channels?.some((c) => c.channel_type === "bitrix24"));
  const hasBitrixConfigured = Boolean(bitrixConfig?.webhook_url && bitrixConfig.webhook_url.trim());
  const showLegacyBitrix = !hasB24InChannels && hasBitrixConfigured && bitrixConfig;
  const hasAnyChannels = (channels && channels.length > 0) || hasBitrixConfigured;

  return (
    <div className="space-y-5">
      {/* Шапка блока */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[#111111]">
            Каналы уведомлений и передачи заявок
          </h2>
          <p className="mt-0.5 text-xs text-[#666666]">
            Куда отправлять оповещения о лидах (Telegram, Email, WhatsApp) и экспорт в Битрикс24
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingChannel(null);
            setModalInitialType("telegram");
            setModalInitialTab("settings");
            setAddModalOpen(true);
          }}
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
            Официальные шлюзы и прямая интеграция с CRM активны
          </p>
          <p className="text-emerald-900 leading-relaxed">
            Платформа использует официальный Bot API Telegram, шлюз WhatsApp и защищенный вебхук Битрикс24
            с гарантированной передачей UTM-меток и Client ID Яндекс.Метрики (<code className="font-mono text-emerald-950">UF_CRM_YA_CID</code>, источник <code className="font-mono text-emerald-950">UC_VWN1ZK</code>).
          </p>
        </div>
      </div>

      {/* Таблица / список каналов */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white overflow-hidden shadow-2xs">
        {isLoading || bitrixLoading ? (
          <div className="p-5 space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : hasAnyChannels ? (
          <div className="divide-y divide-[#f0f0f0]">
            {/* Строка интеграции с Битрикс24, если она настроена через legacy-конфиг */}
            {showLegacyBitrix && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-3 hover:bg-[#fafafa] transition-colors bg-sky-50/20">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-sky-100/70">
                    <Layers className="h-4 w-4 text-[#4a38f5]" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <TagPill color="sky">Битрикс24</TagPill>
                      <span className="font-semibold text-[13px] text-[#111111]">
                        {getBitrixDomain(bitrixConfig.webhook_url)}
                      </span>
                      <span className="text-[10px] text-sky-800 font-medium bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded-[4px]">
                        SOURCE_ID: {bitrixConfig.custom_source_id || "UC_VWN1ZK"}
                      </span>
                      {bitrixConfig.selected_widget_ids && bitrixConfig.selected_widget_ids.length > 0 ? (
                        <span className="text-[10px] text-[#4a38f5] font-medium bg-[#4a38f5]/5 border border-[#4a38f5]/20 px-1.5 py-0.5 rounded-[4px]">
                          Виджеты: {bitrixConfig.selected_widget_ids.length}
                        </span>
                      ) : (
                        <span className="text-[10px] text-[#666666] font-medium bg-[#f5f5f5] border border-[#e5e5e5] px-1.5 py-0.5 rounded-[4px]">
                          Все виджеты
                        </span>
                      )}
                      {bitrixConfig.send_utm_marks && (
                        <span className="text-[10px] text-[#666666] font-medium bg-[#fafafa] border border-[#e5e5e5] px-1.5 py-0.5 rounded-[4px]">
                          UTM
                        </span>
                      )}
                      {bitrixConfig.send_geo_data && (
                        <span className="text-[10px] text-[#666666] font-medium bg-[#fafafa] border border-[#e5e5e5] px-1.5 py-0.5 rounded-[4px]">
                          Geo
                        </span>
                      )}
                      {bitrixConfig.last_lead_id && (
                        <span className="font-mono text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-[4px]">
                          Лид #{bitrixConfig.last_lead_id}
                        </span>
                      )}
                    </div>

                    <div className="mt-1 flex items-center gap-3 text-[11px] text-[#666666]">
                      <span className="flex items-center gap-1">
                        {bitrixConfig.is_enabled ? (
                          <>
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                            <span className="text-emerald-700 font-medium">Экспорт активен</span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="h-3 w-3 text-[#888888]" />
                            <span className="text-[#888888]">Приостановлен</span>
                          </>
                        )}
                      </span>
                      <span>•</span>
                      <span>
                        Источники:{" "}
                        <strong className="text-[#333333]">
                          {bitrixConfig.allowed_sources && bitrixConfig.allowed_sources.length > 0
                            ? bitrixConfig.allowed_sources
                                .map((s) => SOURCE_MAP.get(s)?.shortLabel || s)
                                .join(", ")
                            : "Все каналы"}
                        </strong>
                      </span>
                      {bitrixConfig.last_sync_at && (
                        <>
                          <span>•</span>
                          <span>Посл. отправка: {new Date(bitrixConfig.last_sync_at).toLocaleString("ru-RU")}</span>
                        </>
                      )}
                      {bitrixConfig.last_error && (
                        <>
                          <span>•</span>
                          <span className="text-rose-600 font-medium">Ошибка: {bitrixConfig.last_error}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                  <button
                    type="button"
                    disabled={testingBitrix || !bitrixConfig.is_enabled}
                    onClick={handleTestBitrix}
                    className="h-7 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#111111] transition-colors hover:bg-[#f5f5f5] hover:border-[#cccccc] disabled:opacity-40 inline-flex items-center gap-1"
                  >
                    {testingBitrix && <Loader2 className="h-3 w-3 animate-spin text-[#4a38f5]" />}
                    <span>Тест</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleBitrix}
                    className={`h-7 rounded-[6px] border px-2.5 text-xs font-medium transition-colors ${
                      bitrixConfig.is_enabled
                        ? "border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#f5f5f5]"
                        : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                    }`}
                  >
                    {bitrixConfig.is_enabled ? "Приостановить" : "Включить"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setModalInitialType("bitrix24");
                      setModalInitialTab("logs");
                      setAddModalOpen(true);
                    }}
                    className="h-7 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#111111] transition-colors hover:bg-[#f5f5f5] hover:border-[#cccccc] inline-flex items-center gap-1"
                    title="Открыть журнал синхронизаций с Битрикс24"
                  >
                    <FileText className="h-3 w-3 text-[#666666]" />
                    <span>Журнал</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setModalInitialType("bitrix24");
                      setModalInitialTab("settings");
                      setAddModalOpen(true);
                    }}
                    className="h-7 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#111111] transition-colors hover:bg-[#f5f5f5] hover:border-[#cccccc] inline-flex items-center gap-1"
                    title="Настроить параметры Битрикс24"
                  >
                    <SlidersHorizontal className="h-3 w-3 text-[#666666]" />
                    <span>Настроить</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsDeletingBitrix(true)}
                    className="h-7 w-7 rounded-[6px] border border-rose-200 bg-rose-50 text-rose-600 transition-colors hover:bg-rose-100 flex items-center justify-center"
                    title="Отключить Битрикс24"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Все каналы (Telegram, Email, WhatsApp, Битрикс24) */}
            {channels?.map((channel) => {
              if (channel.channel_type === "bitrix24") {
                const meta = (channel.extra_meta as Record<string, unknown>) ?? {};
                const customSourceId = typeof meta.custom_source_id === "string" && meta.custom_source_id
                  ? meta.custom_source_id
                  : "UC_VWN1ZK";
                const selectedWidgetIds = Array.isArray(meta.selected_widget_ids)
                  ? (meta.selected_widget_ids as string[])
                  : [];
                const allowedSources = Array.isArray(meta.allowed_sources)
                  ? (meta.allowed_sources as LeadSource[])
                  : [];
                const sendUtmMarks = meta.send_utm_marks !== false;
                const sendGeoData = meta.send_geo_data !== false;
                const lastLeadId = meta.last_lead_id ? String(meta.last_lead_id) : null;
                const lastSyncAt = meta.last_sync_at ? String(meta.last_sync_at) : null;
                const lastError = meta.last_error ? String(meta.last_error) : null;

                return (
                  <div
                    key={channel.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-3 hover:bg-[#fafafa] transition-colors bg-sky-50/20"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-sky-100/70">
                        <Layers className="h-4 w-4 text-[#4a38f5]" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <TagPill color="sky">Битрикс24</TagPill>
                          <span className="font-semibold text-[13px] text-[#111111]">
                            {getBitrixDomain(channel.destination)}
                          </span>
                          <span className="text-[10px] text-sky-800 font-medium bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded-[4px]">
                            SOURCE_ID: {customSourceId}
                          </span>
                          {selectedWidgetIds.length > 0 ? (
                            <span className="text-[10px] text-[#4a38f5] font-medium bg-[#4a38f5]/5 border border-[#4a38f5]/20 px-1.5 py-0.5 rounded-[4px]">
                              Виджеты: {selectedWidgetIds.length}
                            </span>
                          ) : (
                            <span className="text-[10px] text-[#666666] font-medium bg-[#f5f5f5] border border-[#e5e5e5] px-1.5 py-0.5 rounded-[4px]">
                              Все виджеты
                            </span>
                          )}
                          {sendUtmMarks && (
                            <span className="text-[10px] text-[#666666] font-medium bg-[#fafafa] border border-[#e5e5e5] px-1.5 py-0.5 rounded-[4px]">
                              UTM
                            </span>
                          )}
                          {sendGeoData && (
                            <span className="text-[10px] text-[#666666] font-medium bg-[#fafafa] border border-[#e5e5e5] px-1.5 py-0.5 rounded-[4px]">
                              Geo
                            </span>
                          )}
                          {lastLeadId && (
                            <span className="font-mono text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-[4px]">
                              Лид #{lastLeadId}
                            </span>
                          )}
                        </div>

                        <div className="mt-1 flex items-center gap-3 text-[11px] text-[#666666]">
                          <span className="flex items-center gap-1">
                            {channel.is_active ? (
                              <>
                                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                <span className="text-emerald-700 font-medium">Экспорт активен</span>
                              </>
                            ) : (
                              <>
                                <AlertCircle className="h-3 w-3 text-[#888888]" />
                                <span className="text-[#888888]">Приостановлен</span>
                              </>
                            )}
                          </span>
                          <span>•</span>
                          <span>
                            Источники:{" "}
                            <strong className="text-[#333333]">
                              {allowedSources.length > 0
                                ? allowedSources
                                    .map((s) => SOURCE_MAP.get(s)?.shortLabel || s)
                                    .join(", ")
                                : "Все каналы"}
                            </strong>
                          </span>
                          {lastSyncAt && (
                            <>
                              <span>•</span>
                              <span>Посл. отправка: {new Date(lastSyncAt).toLocaleString("ru-RU")}</span>
                            </>
                          )}
                          {lastError && (
                            <>
                              <span>•</span>
                              <span className="text-rose-600 font-medium">Ошибка: {lastError}</span>
                            </>
                          )}
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
                        {testingId === channel.id && <Loader2 className="h-3 w-3 animate-spin text-[#4a38f5]" />}
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
                        {channel.is_active ? "Приостановить" : "Включить"}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setEditingChannel(channel);
                          setModalInitialType("bitrix24");
                          setModalInitialTab("logs");
                          setAddModalOpen(true);
                        }}
                        className="h-7 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#111111] transition-colors hover:bg-[#f5f5f5] hover:border-[#cccccc] inline-flex items-center gap-1"
                        title="Открыть журнал синхронизаций с Битрикс24"
                      >
                        <FileText className="h-3 w-3 text-[#666666]" />
                        <span>Журнал</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setEditingChannel(channel);
                          setModalInitialType("bitrix24");
                          setModalInitialTab("settings");
                          setAddModalOpen(true);
                        }}
                        className="h-7 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#111111] transition-colors hover:bg-[#f5f5f5] hover:border-[#cccccc] inline-flex items-center gap-1"
                        title="Настроить параметры Битрикс24"
                      >
                        <SlidersHorizontal className="h-3 w-3 text-[#666666]" />
                        <span>Настроить</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setDeleteId(channel.id)}
                        className="h-7 w-7 rounded-[6px] border border-rose-200 bg-rose-50 text-rose-600 transition-colors hover:bg-rose-100 flex items-center justify-center"
                        title="Удалить канал Битрикс24"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              }

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
                По умолчанию все заявки отправляются на основной email аккаунта. Подключите Telegram-бота,
                WhatsApp или входящий вебхук Битрикс24 для автоматической выгрузки лидов в CRM.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingChannel(null);
                setModalInitialType("telegram");
                setModalInitialTab("settings");
                setAddModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 h-8 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Подключить первый канал</span>
            </button>
          </div>
        )}
      </div>

      {/* Модальное окно добавления/настройки канала с поддержкой Битрикс24 */}
      <AddChannelModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        tenantId={info?.id}
        initialType={modalInitialType}
        initialTab={modalInitialTab}
        editingChannel={editingChannel}
      />

      {/* Диалог подтверждения удаления стандартного канала */}
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

      {/* Диалог подтверждения отключения Битрикс24 */}
      <ConfirmDialog
        open={isDeletingBitrix}
        onClose={() => setIsDeletingBitrix(false)}
        onConfirm={handleDelete}
        title="Отключить интеграцию с Битрикс24?"
        description="URL входящего вебхука будет очищен, и автоматический экспорт лидов в Битрикс24 прекратится."
        confirmLabel="Отключить"
        variant="destructive"
        isPending={updateBitrixMutation.isPending}
      />
    </div>
  );
}
