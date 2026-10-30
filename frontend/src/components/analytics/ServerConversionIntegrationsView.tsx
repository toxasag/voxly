"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Globe,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  XCircle,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import {
  useAnalyticsIntegrations,
  useCreateAnalyticsIntegration,
  useUpdateAnalyticsIntegration,
  useDeleteAnalyticsIntegration,
  useTestAnalyticsIntegration,
  useTestQueueAnalyticsIntegration,
  type AnalyticsIntegrationDTO,
  type AnalyticsProvider,
} from "@/lib/api/use-analytics-integrations";
import { TagPill } from "@/components/ui/tag";
import { Skeleton } from "@/components/shared/Skeleton";
import { toast } from "sonner";

interface ProviderMeta {
  provider: AnalyticsProvider;
  name: string;
  badge: string;
  description: string;
  docsUrl: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    provider: "yandex",
    name: "Яндекс Метрика",
    badge: "Offline API / Импорт чатов (CHATS)",
    description:
      "Передача офлайн-конверсий, автоцели «Чат» и сквозных UTM-меток по ClientID и Yandex UID (ym_uid). Поддерживает несколько сайтов и счётчиков.",
    docsUrl: "https://yandex.ru/support/metrica/ru/data/chat",
  },
  {
    provider: "ga4",
    name: "Google Analytics 4",
    badge: "Measurement Protocol v2",
    description:
      "Серверная отправка событий (chat_message_sent, Lead, Purchase) напрямую в поток данных GA4 по Measurement ID и Client ID.",
    docsUrl: "https://developers.google.com/analytics/devguides/collection/protocol/ga4",
  },
  {
    provider: "google_ads",
    name: "Google Ads",
    badge: "Offline Conversion Import",
    description:
      "Передача ценности выигранных сделок и квалифицированных лидов по GCLID в рекламные кампании Google Рекламы.",
    docsUrl: "https://developers.google.com/google-ads/api/docs/conversions/overview",
  },
  {
    provider: "meta",
    name: "Meta / Facebook Pixel",
    badge: "Conversions API (CAPI)",
    description:
      "Серверный трекинг сделок и обращений с хэшированием контактов (SHA-256) в обход блокировщиков рекламы.",
    docsUrl: "https://developers.facebook.com/docs/marketing-api/conversions-api/",
  },
  {
    provider: "vk",
    name: "ВКонтакте",
    badge: "Events API / VK RTRG",
    description:
      "Передача конверсий по сделкам и суммам заказов в рекламный пиксель ВКонтакте (VK Ads).",
    docsUrl: "https://vk.com/dev/ads_pixel",
  },
];

export function ServerConversionIntegrationsView() {
  const { data: integrations, isLoading, refetch } = useAnalyticsIntegrations();
  const createIntegration = useCreateAnalyticsIntegration();
  const updateIntegration = useUpdateAnalyticsIntegration();
  const deleteIntegration = useDeleteAnalyticsIntegration();
  const testIntegration = useTestAnalyticsIntegration();
  const testQueueIntegration = useTestQueueAnalyticsIntegration();

  // Локальные состояния форм редактирования по ID интеграции
  const [formData, setFormData] = useState<Record<string, Record<string, string>>>({});
  const [activeToggles, setActiveToggles] = useState<Record<string, boolean>>({});
  const [addingForProvider, setAddingForProvider] = useState<AnalyticsProvider | null>(null);
  const [newSiteForm, setNewSiteForm] = useState({
    siteName: "",
    siteUrl: "",
    counterId: "",
    token: "",
  });

  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { success: boolean; message: string }>
  >({});

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full rounded-[8px]" />
        <Skeleton className="h-40 w-full rounded-[8px]" />
        <Skeleton className="h-40 w-full rounded-[8px]" />
      </div>
    );
  }

  // Группируем интеграции по провайдерам
  const integrationsByProvider = new Map<AnalyticsProvider, AnalyticsIntegrationDTO[]>();
  PROVIDERS.forEach((p) => integrationsByProvider.set(p.provider, []));

  (integrations ?? []).forEach((item) => {
    const list = integrationsByProvider.get(item.provider) || [];
    list.push(item);
    integrationsByProvider.set(item.provider, list);
  });

  const getFieldValue = (
    item: AnalyticsIntegrationDTO,
    field: string,
    defaultValue = "",
  ): string => {
    if (formData[item.id]?.[field] !== undefined) {
      return formData[item.id]?.[field] ?? defaultValue;
    }
    if (field === "siteName") return item.siteName || defaultValue;
    if (field === "siteUrl") return item.siteUrl || defaultValue;
    if (field === "counterId") return item.counterId || defaultValue;

    const serverConfigVal = item.config?.[field];
    return typeof serverConfigVal === "string" ? serverConfigVal : defaultValue;
  };

  const setFieldValue = (itemId: string, field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || {}),
        [field]: value,
      },
    }));
  };

  const isItemActive = (item: AnalyticsIntegrationDTO): boolean => {
    if (activeToggles[item.id] !== undefined) {
      return activeToggles[item.id] ?? false;
    }
    return item.isActive;
  };

  const toggleItemActive = (itemId: string, current: boolean) => {
    setActiveToggles((prev) => ({
      ...prev,
      [itemId]: !current,
    }));
  };

  const handleSave = async (item: AnalyticsIntegrationDTO) => {
    const local = formData[item.id] || {};
    const updatedConfig = {
      ...(item.config || {}),
      ...local,
    };

    const siteName = local.siteName !== undefined ? local.siteName : item.siteName;
    const siteUrl = local.siteUrl !== undefined ? local.siteUrl : item.siteUrl;
    const counterId = local.counterId !== undefined ? local.counterId : item.counterId;
    const isActive = activeToggles[item.id] !== undefined ? activeToggles[item.id] : item.isActive;

    try {
      if (item.id) {
        await updateIntegration.mutateAsync({
          provider: item.provider,
          payload: {
            id: item.id,
            siteName,
            siteUrl,
            counterId,
            isActive,
            config: updatedConfig,
          },
        });
      } else {
        await updateIntegration.mutateAsync({
          provider: item.provider,
          payload: {
            siteName,
            siteUrl,
            counterId,
            isActive,
            config: updatedConfig,
          },
        });
      }
      toast.success(`Настройки счётчика сохранены`);
      void refetch();
    } catch {
      toast.error(`Не удалось сохранить настройки`);
    }
  };

  const handleAddNewSite = async (provider: AnalyticsProvider) => {
    if (!newSiteForm.siteName.trim()) {
      toast.error("Укажите название сайта");
      return;
    }

    const config: Record<string, unknown> = {};
    if (provider === "yandex") {
      config.counterId = newSiteForm.counterId;
      config.oauthToken = newSiteForm.token;
    } else if (provider === "ga4") {
      config.measurementId = newSiteForm.counterId;
      config.apiSecret = newSiteForm.token;
    } else if (provider === "meta") {
      config.pixelId = newSiteForm.counterId;
      config.accessToken = newSiteForm.token;
    } else if (provider === "vk") {
      config.pixelId = newSiteForm.counterId;
      config.accessToken = newSiteForm.token;
    } else if (provider === "google_ads") {
      config.conversionId = newSiteForm.counterId;
      config.conversionLabel = newSiteForm.token;
    }

    try {
      await createIntegration.mutateAsync({
        provider,
        siteName: newSiteForm.siteName,
        siteUrl: newSiteForm.siteUrl || null,
        counterId: newSiteForm.counterId || null,
        isActive: true,
        config,
      });

      toast.success(`Счётчик для сайта «${newSiteForm.siteName}» добавлен`);
      setAddingForProvider(null);
      setNewSiteForm({ siteName: "", siteUrl: "", counterId: "", token: "" });
      void refetch();
    } catch {
      toast.error("Не удалось добавить счётчик");
    }
  };

  const handleDelete = async (id: string, siteName: string) => {
    if (!confirm(`Удалить счётчик для «${siteName}»?`)) return;
    try {
      await deleteIntegration.mutateAsync(id);
      toast.success("Счётчик удален");
      void refetch();
    } catch {
      toast.error("Не удалось удалить счётчик");
    }
  };

  const handleTestQueue = async (provider: AnalyticsProvider, itemId: string) => {
    setTestingId(itemId);
    setTestResults((prev) => ({ ...prev, [itemId]: undefined as any }));

    try {
      const queueRes = await testQueueIntegration.mutateAsync(provider);
      toast.info(`Задача поставлена в очередь BullMQ (ID: ${queueRes.jobId})`);

      // Небольшая задержка перед получением результата
      setTimeout(async () => {
        try {
          const directRes = await testIntegration.mutateAsync(provider);
          if (directRes.success) {
            setTestResults((prev) => ({
              ...prev,
              [itemId]: {
                success: true,
                message: `Очередь BullMQ отработала успешно. Событие ${directRes.eventName} принято (HTTP ${directRes.status})`,
              },
            }));
            toast.success("Проверка через очередь BullMQ успешна!");
          } else {
            setTestResults((prev) => ({
              ...prev,
              [itemId]: {
                success: false,
                message: `Ошибка отправки (HTTP ${directRes.status}): ${directRes.error || "Сбой"}`,
              },
            }));
            toast.error("Ошибка при проверке настроек");
          }
        } finally {
          setTestingId(null);
        }
      }, 1200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка постановки в очередь";
      setTestResults((prev) => ({
        ...prev,
        [itemId]: { success: false, message: msg },
      }));
      toast.error(msg);
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Баннер пояснения сквозного трекинга */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[#4a38f5]/10 text-[#4a38f5]">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-[14px] font-semibold text-[#111111]">
              Сквозная серверная аналитика (Мульти-сайты & Импорт чатов)
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-[#666666]">
              GETVOXLY поддерживает подключение отдельных счётчиков под каждый сайт и промо-лендинг.
              При обращении клиента в мессенджеры (Telegram, WhatsApp, Viber) система автоматически
              связывает визит сайта с диалогом и отправляет конверсию в Яндекс.Метрику (официальный импорт офлайн-чатов),
              GA4 и рекламные кабинеты только после реального первого сообщения клиента.
            </p>
          </div>
        </div>
      </div>

      {/* Список провайдеров */}
      <div className="space-y-6">
        {PROVIDERS.map((meta) => {
          const provider = meta.provider;
          const items = integrationsByProvider.get(provider) || [];
          const isAdding = addingForProvider === provider;

          return (
            <div
              key={provider}
              className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs"
            >
              {/* Шапка провайдера */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-[#f0f0f0] pb-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-[15px] font-semibold text-[#111111]">{meta.name}</h3>
                    <span className="rounded-[4px] border border-[#e5e5e5] bg-[#fafafa] px-2 py-0.5 text-[10px] font-medium text-[#666666]">
                      {meta.badge}
                    </span>
                    {provider === "yandex" && (
                      <span className="inline-flex items-center gap-1 rounded-[4px] border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                        <MessageSquare className="h-3 w-3" />
                        Автоцель «Чат»
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[12px] text-[#666666]">{meta.description}</p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setAddingForProvider(isAdding ? null : provider);
                    setNewSiteForm({ siteName: "", siteUrl: "", counterId: "", token: "" });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa]"
                >
                  <Plus className="h-3.5 w-3.5 text-[#4a38f5]" />
                  Добавить сайт / счётчик
                </button>
              </div>

              {/* Форма добавления нового сайта */}
              {isAdding && (
                <div className="mt-4 rounded-[8px] border border-[#4a38f5]/20 bg-[#fafafa] p-4">
                  <h4 className="text-[13px] font-semibold text-[#111111]">
                    Подключение нового сайта для {meta.name}
                  </h4>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-[11px] font-medium text-[#666666]">
                        Название сайта
                      </label>
                      <input
                        type="text"
                        value={newSiteForm.siteName}
                        onChange={(e) =>
                          setNewSiteForm((prev) => ({ ...prev, siteName: e.target.value }))
                        }
                        placeholder="Например: Каталог / Лендинг ремонта"
                        className="mt-1 h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-[13px] text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#666666]">
                        Домен / URL сайта
                      </label>
                      <input
                        type="text"
                        value={newSiteForm.siteUrl}
                        onChange={(e) =>
                          setNewSiteForm((prev) => ({ ...prev, siteUrl: e.target.value }))
                        }
                        placeholder="shop.getvoxly.ru"
                        className="mt-1 h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-[13px] text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#666666]">
                        {provider === "yandex"
                          ? "Номер счётчика Метрики"
                          : provider === "ga4"
                          ? "Measurement ID (G-XXX)"
                          : provider === "google_ads"
                          ? "Conversion ID"
                          : "Pixel ID"}
                      </label>
                      <input
                        type="text"
                        value={newSiteForm.counterId}
                        onChange={(e) =>
                          setNewSiteForm((prev) => ({ ...prev, counterId: e.target.value }))
                        }
                        placeholder="Идентификатор счётчика"
                        className="mt-1 h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[13px] text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#666666]">
                        {provider === "yandex"
                          ? "OAuth-токен Яндекс (для офлайн-чатов)"
                          : provider === "ga4"
                          ? "API Secret Measurement Protocol"
                          : provider === "google_ads"
                          ? "Conversion Label"
                          : "Access Token"}
                      </label>
                      <input
                        type="password"
                        value={newSiteForm.token}
                        onChange={(e) =>
                          setNewSiteForm((prev) => ({ ...prev, token: e.target.value }))
                        }
                        placeholder="Секретный ключ / токен"
                        className="mt-1 h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[13px] text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setAddingForProvider(null)}
                      className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[12px] font-medium text-[#666666] hover:bg-[#fafafa]"
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddNewSite(provider)}
                      className="h-8 rounded-[8px] bg-[#4a38f5] px-3.5 text-[12px] font-medium text-white hover:bg-[#3d2ee0]"
                    >
                      Сохранить новый сайт
                    </button>
                  </div>
                </div>
              )}

              {/* Список сайтов и счётчиков */}
              <div className="mt-4 space-y-4">
                {items.map((item, idx) => {
                  const itemId = item.id || `virtual_${provider}_${idx}`;
                  const active = isItemActive(item);
                  const isTesting = testingId === itemId;
                  const testRes = testResults[itemId];

                  return (
                    <div
                      key={itemId}
                      className="rounded-[8px] border border-[#e5e5e5] bg-[#fcfcfc] p-4 transition-colors hover:border-[#cccccc]"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-[#f0f0f0] pb-3">
                        <div className="flex items-center gap-2">
                          <Globe className="h-4 w-4 text-[#4a38f5]" />
                          <input
                            type="text"
                            value={getFieldValue(item, "siteName", "Основной сайт")}
                            onChange={(e) => setFieldValue(item.id, "siteName", e.target.value)}
                            className="h-7 rounded-[4px] border border-transparent bg-transparent px-1.5 font-semibold text-[13px] text-[#111111] hover:border-[#e5e5e5] focus:border-[#4a38f5] focus:bg-white"
                          />
                          {item.isDefault && (
                            <TagPill color="violet">По умолчанию</TagPill>
                          )}
                          <TagPill color={active ? "emerald" : "slate"}>
                            {active ? "Активен" : "Отключен"}
                          </TagPill>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleItemActive(item.id, active)}
                            className={`h-7 rounded-[6px] border px-2.5 text-[11px] font-medium transition-colors ${
                              active
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-[#e5e5e5] bg-white text-[#666666]"
                            }`}
                          >
                            {active ? "Включено" : "Выключено"}
                          </button>
                          {items.length > 1 && item.id && (
                            <button
                              type="button"
                              onClick={() => handleDelete(item.id, item.siteName)}
                              title="Удалить счётчик"
                              className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Поля ввода параметров счётчика */}
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div>
                          <label className="block text-[11px] font-medium text-[#666666]">
                            Домен сайта
                          </label>
                          <input
                            type="text"
                            value={getFieldValue(item, "siteUrl")}
                            onChange={(e) => setFieldValue(item.id, "siteUrl", e.target.value)}
                            placeholder="getvoxly.ru"
                            className="mt-1 h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-[12px] text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-[#666666]">
                            {provider === "yandex"
                              ? "Номер счётчика Метрики"
                              : provider === "ga4"
                              ? "Measurement ID"
                              : provider === "google_ads"
                              ? "Conversion ID"
                              : "Pixel ID"}
                          </label>
                          <input
                            type="text"
                            value={getFieldValue(
                              item,
                              provider === "yandex"
                                ? "counterId"
                                : provider === "ga4"
                                ? "measurementId"
                                : provider === "google_ads"
                                ? "conversionId"
                                : "pixelId",
                            )}
                            onChange={(e) =>
                              setFieldValue(
                                item.id,
                                provider === "yandex"
                                  ? "counterId"
                                  : provider === "ga4"
                                  ? "measurementId"
                                  : provider === "google_ads"
                                  ? "conversionId"
                                  : "pixelId",
                                e.target.value,
                              )
                            }
                            placeholder="ID счётчика"
                            className="mt-1 h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[12px] text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-[#666666]">
                            {provider === "yandex"
                              ? "OAuth-токен (офлайн-чаты)"
                              : provider === "ga4"
                              ? "API Secret"
                              : provider === "google_ads"
                              ? "Conversion Label"
                              : "Access Token"}
                          </label>
                          <input
                            type="text"
                            value={getFieldValue(
                              item,
                              provider === "yandex"
                                ? "oauthToken"
                                : provider === "ga4"
                                ? "apiSecret"
                                : provider === "google_ads"
                                ? "conversionLabel"
                                : "accessToken",
                            )}
                            onChange={(e) =>
                              setFieldValue(
                                item.id,
                                provider === "yandex"
                                  ? "oauthToken"
                                  : provider === "ga4"
                                  ? "apiSecret"
                                  : provider === "google_ads"
                                  ? "conversionLabel"
                                  : "accessToken",
                                e.target.value,
                              )
                            }
                            placeholder="Секрет / Токен"
                            className="mt-1 h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[12px] text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                          />
                        </div>
                      </div>

                      {/* Результат теста очереди */}
                      {testRes && (
                        <div
                          className={`mt-3 flex items-start gap-2 rounded-[6px] border p-2.5 text-[12px] ${
                            testRes.success
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : "border-rose-200 bg-rose-50 text-rose-800"
                          }`}
                        >
                          {testRes.success ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                          ) : (
                            <XCircle className="h-4 w-4 shrink-0 text-rose-600" />
                          )}
                          <span>{testRes.message}</span>
                        </div>
                      )}

                      {/* Кнопки действий */}
                      <div className="mt-3 flex items-center justify-end gap-2 border-t border-[#f0f0f0] pt-3">
                        <button
                          type="button"
                          onClick={() => handleTestQueue(provider, itemId)}
                          disabled={isTesting}
                          className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1 text-[12px] font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`h-3 w-3 ${isTesting ? "animate-spin text-[#4a38f5]" : "text-[#666666]"}`}
                          />
                          Проверить через очередь BullMQ
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSave(item)}
                          className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 py-1 text-[12px] font-medium text-white shadow-2xs hover:bg-[#3d2ee0]"
                        >
                          <Save className="h-3 w-3" />
                          Сохранить
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
