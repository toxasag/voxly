"use client";

import { useState } from "react";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Globe,
  Key,
  Layers,
  Play,
  Save,
  Send,
  Share2,
  ShieldCheck,
  TrendingUp,
  XCircle,
} from "lucide-react";
import {
  useAnalyticsIntegrations,
  useTestAnalyticsIntegration,
  useUpdateAnalyticsIntegration,
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
    badge: "Offline API / Measurement Protocol",
    description:
      "Передача офлайн-конверсий, достижений целей и сквозных UTM-меток по ClientID и Yandex UID (ym_uid).",
    docsUrl: "https://yandex.ru/dev/metrika/doc/api2/management/offline_conversion/upload.html",
  },
  {
    provider: "ga4",
    name: "Google Analytics 4",
    badge: "Measurement Protocol v2",
    description:
      "Серверная отправка событий (Lead, Purchase) напрямую в поток данных GA4 по Measurement ID и Client ID.",
    docsUrl: "https://developers.google.com/analytics/devguides/collection/protocol/ga4",
  },
  {
    provider: "google_ads",
    name: "Google Ads",
    badge: "Offline Conversion Import",
    description:
      "Передача ценности выигранных сделок и квалифицированных лидов в рекламные кампании Google Рекламы.",
    docsUrl: "https://developers.google.com/google-ads/api/docs/conversions/overview",
  },
  {
    provider: "meta",
    name: "Meta / Facebook Pixel",
    badge: "Conversions API (CAPI)",
    description:
      "Серверный трекинг сделок и LTV с хэшированием персональных данных (SHA-256 phone/email) в обход блокировщиков рекламы.",
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
  const updateIntegration = useUpdateAnalyticsIntegration();
  const testIntegration = useTestAnalyticsIntegration();

  // Локальные состояния форм для каждого провайдера
  const [formData, setFormData] = useState<Record<string, Record<string, string>>>({});
  const [activeToggles, setActiveToggles] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<
    Record<string, { success: boolean; message: string }>
  >({});
  const [testingProvider, setTestingProvider] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full rounded-[8px]" />
        <Skeleton className="h-40 w-full rounded-[8px]" />
        <Skeleton className="h-40 w-full rounded-[8px]" />
      </div>
    );
  }

  const integrationsByProvider = new Map(
    (integrations ?? []).map((item) => [item.provider, item]),
  );

  const getFormValue = (provider: AnalyticsProvider, field: string, defaultValue = ""): string => {
    if (formData[provider]?.[field] !== undefined) {
      return formData[provider]?.[field] ?? defaultValue;
    }
    const serverVal = integrationsByProvider.get(provider)?.config?.[field];
    return typeof serverVal === "string" ? serverVal : defaultValue;
  };

  const setFieldValue = (provider: AnalyticsProvider, field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [provider]: {
        ...(prev[provider] || {}),
        [field]: value,
      },
    }));
  };

  const isProviderActive = (provider: AnalyticsProvider): boolean => {
    if (activeToggles[provider] !== undefined) {
      return activeToggles[provider] ?? false;
    }
    return integrationsByProvider.get(provider)?.isActive ?? false;
  };

  const toggleProviderActive = (provider: AnalyticsProvider) => {
    const current = isProviderActive(provider);
    setActiveToggles((prev) => ({
      ...prev,
      [provider]: !current,
    }));
  };

  const handleSave = async (provider: AnalyticsProvider) => {
    const currentConfig = integrationsByProvider.get(provider)?.config ?? {};
    const localForm = formData[provider] ?? {};

    const updatedConfig = {
      ...currentConfig,
      ...localForm,
    };

    const isActive = isProviderActive(provider);

    try {
      await updateIntegration.mutateAsync({
        provider,
        payload: {
          isActive,
          config: updatedConfig,
        },
      });
      toast.success(`Настройки интеграции ${provider.toUpperCase()} сохранены`);
      void refetch();
    } catch {
      toast.error(`Не удалось сохранить настройки ${provider.toUpperCase()}`);
    }
  };

  const handleTest = async (provider: AnalyticsProvider) => {
    setTestingProvider(provider);
    setTestResults((prev) => ({ ...prev, [provider]: undefined as any }));

    try {
      const res = await testIntegration.mutateAsync(provider);
      if (res.success) {
        setTestResults((prev) => ({
          ...prev,
          [provider]: {
            success: true,
            message: `Событие ${res.eventName} успешно отправлено (HTTP ${res.status})`,
          },
        }));
        toast.success(`Тест ${provider.toUpperCase()} успешен!`);
      } else {
        setTestResults((prev) => ({
          ...prev,
          [provider]: {
            success: false,
            message: `Ошибка (HTTP ${res.status}): ${res.error || "Сбой отправки"}`,
          },
        }));
        toast.error(`Ошибка при тесте ${provider.toUpperCase()}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Не удалось выполнить проверку";
      setTestResults((prev) => ({
        ...prev,
        [provider]: {
          success: false,
          message: msg,
        },
      }));
      toast.error(msg);
    } finally {
      setTestingProvider(null);
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
              Серверная отправка конверсий (Server-to-Server)
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-[#666666]">
              При изменении этапов сделок (заявка, квалификация, успешная продажа) GETVOXLY автоматически
              отправляет события в подключенные счётчики и пиксели через защищённые фоновые очереди BullMQ.
              Данные передаются без потери из-за AdBlock и Safari ITP с передачей Client ID, YM UID и хэшированных контактов.
            </p>
          </div>
        </div>
      </div>

      {/* Список интеграций */}
      <div className="space-y-4">
        {PROVIDERS.map((meta) => {
          const provider = meta.provider;
          const active = isProviderActive(provider);
          const isTesting = testingProvider === provider;
          const testRes = testResults[provider];

          return (
            <div
              key={provider}
              className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs transition-colors hover:border-[#cccccc]"
            >
              {/* Шапка карточки */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-[14px] font-semibold text-[#111111]">{meta.name}</h3>
                    <TagPill color={active ? "emerald" : "slate"}>
                      {active ? "Активен" : "Отключен"}
                    </TagPill>
                    <span className="rounded-[4px] border border-[#e5e5e5] bg-[#fafafa] px-2 py-0.5 text-[10px] font-medium text-[#666666]">
                      {meta.badge}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] text-[#666666]">{meta.description}</p>
                </div>

                {/* Тумблер активности */}
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-[#666666]">
                    {active ? "Включено" : "Выключено"}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleProviderActive(provider)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      active ? "bg-[#4a38f5]" : "bg-[#e5e5e5]"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        active ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Поля конфигурации */}
              <div className="mt-4 border-t border-[#f0f0f0] pt-4">
                {/* 1. Яндекс Метрика */}
                {provider === "yandex" && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-[11px] font-medium text-[#666666]">
                        Номер счётчика Метрики
                      </label>
                      <input
                        type="text"
                        value={getFormValue("yandex", "counterId")}
                        onChange={(e) => setFieldValue("yandex", "counterId", e.target.value)}
                        placeholder="Например: 98765432"
                        className="mt-1 h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#666666]">
                        OAuth токен Яндекс (для загрузки офлайн-конверсий)
                      </label>
                      <input
                        type="text"
                        value={getFormValue("yandex", "oauthToken")}
                        onChange={(e) => setFieldValue("yandex", "oauthToken", e.target.value)}
                        placeholder="y0_AgAAAA..."
                        className="mt-1 h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>
                  </div>
                )}

                {/* 2. Google Analytics 4 */}
                {provider === "ga4" && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-[11px] font-medium text-[#666666]">
                        Measurement ID (Идентификатор потока)
                      </label>
                      <input
                        type="text"
                        value={getFormValue("ga4", "measurementId")}
                        onChange={(e) => setFieldValue("ga4", "measurementId", e.target.value)}
                        placeholder="G-XXXXXXXXXX"
                        className="mt-1 h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#666666]">
                        API Secret Measurement Protocol
                      </label>
                      <input
                        type="text"
                        value={getFormValue("ga4", "apiSecret")}
                        onChange={(e) => setFieldValue("ga4", "apiSecret", e.target.value)}
                        placeholder="Создаётся в настройках потока данных GA4"
                        className="mt-1 h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>
                  </div>
                )}

                {/* 3. Google Ads */}
                {provider === "google_ads" && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-[11px] font-medium text-[#666666]">
                        Customer ID (Идентификатор клиента)
                      </label>
                      <input
                        type="text"
                        value={getFormValue("google_ads", "customerId")}
                        onChange={(e) => setFieldValue("google_ads", "customerId", e.target.value)}
                        placeholder="123-456-7890"
                        className="mt-1 h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#666666]">
                        Conversion Action ID
                      </label>
                      <input
                        type="text"
                        value={getFormValue("google_ads", "conversionActionId")}
                        onChange={(e) =>
                          setFieldValue("google_ads", "conversionActionId", e.target.value)
                        }
                        placeholder="Например: 987654321"
                        className="mt-1 h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>
                  </div>
                )}

                {/* 4. Meta Pixel */}
                {provider === "meta" && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="block text-[11px] font-medium text-[#666666]">Pixel ID</label>
                      <input
                        type="text"
                        value={getFormValue("meta", "pixelId")}
                        onChange={(e) => setFieldValue("meta", "pixelId", e.target.value)}
                        placeholder="123456789012345"
                        className="mt-1 h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#666666]">
                        Access Token (CAPI)
                      </label>
                      <input
                        type="text"
                        value={getFormValue("meta", "accessToken")}
                        onChange={(e) => setFieldValue("meta", "accessToken", e.target.value)}
                        placeholder="EAAB..."
                        className="mt-1 h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#666666]">
                        Test Event Code (опционально)
                      </label>
                      <input
                        type="text"
                        value={getFormValue("meta", "testEventCode")}
                        onChange={(e) => setFieldValue("meta", "testEventCode", e.target.value)}
                        placeholder="TEST12345"
                        className="mt-1 h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>
                  </div>
                )}

                {/* 5. VK RTRG */}
                {provider === "vk" && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-[11px] font-medium text-[#666666]">ID пикселя VK</label>
                      <input
                        type="text"
                        value={getFormValue("vk", "pixelId")}
                        onChange={(e) => setFieldValue("vk", "pixelId", e.target.value)}
                        placeholder="VK-RTRG-12345-XXXXX"
                        className="mt-1 h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#666666]">
                        Access Token API ВКонтакте
                      </label>
                      <input
                        type="text"
                        value={getFormValue("vk", "accessToken")}
                        onChange={(e) => setFieldValue("vk", "accessToken", e.target.value)}
                        placeholder="vk1.a...."
                        className="mt-1 h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>
                  </div>
                )}

                {/* Результат проверки подключения */}
                {testRes && (
                  <div
                    className={`mt-3 flex items-center gap-2 rounded-[8px] border p-2.5 text-[12px] ${
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

                {/* Кнопки действий: Сохранить и Тестовая отправка */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#f0f0f0] pt-3">
                  <a
                    href={meta.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-[#666666] underline hover:text-[#4a38f5]"
                  >
                    Документация протокола
                  </a>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isTesting}
                      onClick={() => void handleTest(provider)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[12px] font-medium text-[#111111] shadow-2xs transition-colors hover:bg-[#fafafa] disabled:opacity-50"
                    >
                      <Play className="h-3.5 w-3.5 text-[#666666]" />
                      {isTesting ? "Тестирование..." : "Тестовая отправка"}
                    </button>
                    <button
                      type="button"
                      disabled={updateIntegration.isPending}
                      onClick={() => void handleSave(provider)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 text-[12px] font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50"
                    >
                      <Save className="h-3.5 w-3.5" />
                      Сохранить
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
