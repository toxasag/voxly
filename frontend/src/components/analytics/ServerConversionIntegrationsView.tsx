"use client";

import { useMemo, useState } from "react";
import {
  BarChart3,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  Loader2,
  Megaphone,
  Pencil,
  Plus,
  Radio,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  useAnalyticsIntegrations,
  useCreateAnalyticsIntegration,
  useUpdateAnalyticsIntegration,
  useDeleteAnalyticsIntegration,
  useTestAnalyticsIntegrationById,
  type AnalyticsIntegrationDTO,
  type AnalyticsProvider,
  type CanonicalAnalyticsProvider,
  normalizeAnalyticsProvider,
} from "@/lib/api/use-analytics-integrations";
import { TagPill } from "@/components/ui/tag";
import { Skeleton } from "@/components/shared/Skeleton";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { toast } from "sonner";

interface ProviderMeta {
  provider: CanonicalAnalyticsProvider;
  name: string;
  badge: string;
  description: string;
  counterLabel: string;
  counterPlaceholder: string;
  tokenLabel: string;
  tokenPlaceholder: string;
  tokenKey: string;
  hasTestEventCode?: boolean;
}

const PROVIDERS_CATALOG: ProviderMeta[] = [
  {
    provider: "yandex",
    name: "Яндекс Метрика",
    badge: "Offline API / CHATS",
    description: "Передача офлайн-конверсий, автоцели «Чат» и сквозных UTM-меток по ClientID и Yandex UID (ym_uid).",
    counterLabel: "Номер счётчика (Counter ID)",
    counterPlaceholder: "Например: 98765432",
    tokenLabel: "OAuth-токен Яндекс",
    tokenPlaceholder: "y0_AgA...",
    tokenKey: "oauthToken",
  },
  {
    provider: "ga4",
    name: "Google Analytics 4",
    badge: "Measurement Protocol v2",
    description: "Серверная отправка событий (Lead, Purchase, chat_message) напрямую в поток данных GA4.",
    counterLabel: "Measurement ID",
    counterPlaceholder: "G-XXXXXXXXXX",
    tokenLabel: "API Secret",
    tokenPlaceholder: "Секретный ключ потока данных",
    tokenKey: "apiSecret",
  },
  {
    provider: "google_ads",
    name: "Google Ads",
    badge: "Offline Conversion Import",
    description: "Передача ценности выигранных сделок и квалифицированных лидов по GCLID в Google Рекламу.",
    counterLabel: "Customer ID / Conversion ID",
    counterPlaceholder: "123-456-7890",
    tokenLabel: "Conversion Action Label",
    tokenPlaceholder: "AbC_123456789",
    tokenKey: "conversionLabel",
  },
  {
    provider: "meta",
    name: "Meta / Facebook Pixel",
    badge: "Conversions API (CAPI)",
    description: "Серверный трекинг сделок и обращений с хэшированием контактов (SHA-256) в обход блокировщиков.",
    counterLabel: "Pixel ID",
    counterPlaceholder: "123456789012345",
    tokenLabel: "Access Token (CAPI)",
    tokenPlaceholder: "EAA...",
    tokenKey: "accessToken",
    hasTestEventCode: true,
  },
  {
    provider: "vk",
    name: "ВКонтакте",
    badge: "Events API / VK RTRG",
    description: "Передача конверсий по сделкам и суммам заказов в рекламный пиксель ВКонтакте (VK Ads).",
    counterLabel: "ID пикселя (VK-RTRG)",
    counterPlaceholder: "VK-RTRG-123456-XXXXX",
    tokenLabel: "Access Token",
    tokenPlaceholder: "vk1.a...",
    tokenKey: "accessToken",
  },
];

interface YandexGoalGuide {
  id: string;
  name: string;
  identifier: string;
  aliases: string[];
  triggerCondition: string;
  type: string;
  payloadInfo: string;
}

const YANDEX_GOALS: YandexGoalGuide[] = [
  {
    id: "lead",
    name: "Новый квалифицированный лид",
    identifier: "lead",
    aliases: ["submit_lead", "lead_qualified"],
    triggerCondition: "Получены контакты клиента (телефон, email, telegram) или сделка переведена в этап «Новый лид»",
    type: "JavaScript-событие",
    payloadInfo: "Передаётся ClientID, номер телефона, email и UTM-метки источника",
  },
  {
    id: "purchase",
    name: "Успешная продажа / Оплата",
    identifier: "purchase",
    aliases: ["sale", "order_paid"],
    triggerCondition: "Сделка успешно закрыта и переведена в статус «Успешно реализована»",
    type: "JavaScript-событие",
    payloadInfo: "Передаётся сумма сделки (бюджет в рублях), валюта RUB и ClientID",
  },
  {
    id: "chat",
    name: "Первое сообщение в чат / Мессенджер",
    identifier: "chat",
    aliases: ["getvoxly_messenger_click", "first_message"],
    triggerCondition: "Посетитель отправил первое входящее сообщение через веб-чат или мессенджер",
    type: "JavaScript-событие",
    payloadInfo: "Передаётся ClientID посетителя, платформа чата и URL страницы",
  },
];

export function ServerConversionIntegrationsView() {
  const { data: integrations = [], isLoading, refetch } = useAnalyticsIntegrations();
  const createMutation = useCreateAnalyticsIntegration();
  const updateMutation = useUpdateAnalyticsIntegration();
  const deleteMutation = useDeleteAnalyticsIntegration();
  const testMutation = useTestAnalyticsIntegrationById();

  // Фильтрация и поиск
  const [selectedSiteFilter, setSelectedSiteFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Тестирование конкретных счетчиков
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { success: boolean; status: number; message: string }>
  >({});

  // Slide-over Sheet для добавления / редактирования
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<AnalyticsIntegrationDTO | null>(null);

  // Форма в Sheet
  const [sheetProvider, setSheetProvider] = useState<CanonicalAnalyticsProvider>("yandex");
  const [sheetName, setSheetName] = useState("");
  const [sheetSiteUrl, setSheetSiteUrl] = useState("");
  const [sheetCounterId, setSheetCounterId] = useState("");
  const [sheetToken, setSheetToken] = useState("");
  const [sheetTestEventCode, setSheetTestEventCode] = useState("");
  const [sheetIsActive, setSheetIsActive] = useState(true);
  const [sheetEventRules, setSheetEventRules] = useState({
    onLeadCreated: true,
    onDealWon: true,
    onFirstMessage: true,
  });
  const [copiedGoal, setCopiedGoal] = useState<string | null>(null);

  // Уникальные сайты для фильтра в тулбаре
  const uniqueSites = useMemo(() => {
    const set = new Set<string>();
    integrations.forEach((item) => {
      const url = item.siteUrl?.trim();
      if (url) {
        try {
          const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
          set.add(host);
        } catch {
          set.add(url);
        }
      } else if (item.siteName?.trim()) {
        set.add(item.siteName.trim());
      }
    });
    return Array.from(set);
  }, [integrations]);

  // Отфильтрованные интеграции
  const filteredIntegrations = useMemo(() => {
    return integrations.filter((item) => {
      // Фильтр по сайту
      if (selectedSiteFilter !== "all") {
        const itemSite = item.siteUrl || item.siteName || "";
        if (!itemSite.toLowerCase().includes(selectedSiteFilter.toLowerCase())) {
          return false;
        }
      }

      // Поисковый запрос
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = (item.name || item.siteName || "").toLowerCase().includes(q);
        const matchesUrl = (item.siteUrl || "").toLowerCase().includes(q);
        const matchesCounter = (item.counterId || "").toLowerCase().includes(q);
        const matchesProvider = item.provider.toLowerCase().includes(q);
        if (!matchesName && !matchesUrl && !matchesCounter && !matchesProvider) {
          return false;
        }
      }

      return true;
    });
  }, [integrations, selectedSiteFilter, searchQuery]);

  const openCreateSheet = (providerPrefill: CanonicalAnalyticsProvider = "yandex") => {
    setEditingItem(null);
    setSheetProvider(providerPrefill);
    setSheetName("");
    setSheetSiteUrl("");
    setSheetCounterId("");
    setSheetToken("");
    setSheetTestEventCode("");
    setSheetIsActive(true);
    setSheetEventRules({
      onLeadCreated: true,
      onDealWon: true,
      onFirstMessage: true,
    });
    setIsSheetOpen(true);
  };

  const openEditSheet = (item: AnalyticsIntegrationDTO) => {
    const canonical = normalizeAnalyticsProvider(item.provider);
    setEditingItem(item);
    setSheetProvider(canonical);
    setSheetName(item.name || item.siteName || "");
    setSheetSiteUrl(item.siteUrl || "");
    setSheetCounterId(item.counterId || "");

    const cfg = item.config || item.credentials || {};
    const meta = PROVIDERS_CATALOG.find((p) => p.provider === canonical);
    const tokenVal = meta ? (cfg[meta.tokenKey] as string) || "" : "";
    setSheetToken(tokenVal);
    setSheetTestEventCode((cfg.testEventCode as string) || "");

    setSheetIsActive(item.isActive);
    setSheetEventRules({
      onLeadCreated: item.eventRules?.onLeadCreated ?? true,
      onDealWon: item.eventRules?.onDealWon ?? true,
      onFirstMessage: item.eventRules?.onFirstMessage ?? true,
    });
    setIsSheetOpen(true);
  };

  const handleSaveSheet = async () => {
    if (!sheetName.trim()) {
      toast.error("Укажите понятное название сайта или счётчика");
      return;
    }
    if (!sheetCounterId.trim()) {
      toast.error("Укажите ID счётчика или пикселя");
      return;
    }

    const meta = PROVIDERS_CATALOG.find((p) => p.provider === sheetProvider);
    const credentials: Record<string, unknown> = {
      counterId: sheetCounterId.trim(),
    };

    if (sheetProvider === "yandex") {
      credentials.counterId = sheetCounterId.trim();
      credentials.oauthToken = sheetToken.trim();
    } else if (sheetProvider === "ga4") {
      credentials.measurementId = sheetCounterId.trim();
      credentials.apiSecret = sheetToken.trim();
    } else if (sheetProvider === "google_ads") {
      credentials.conversionId = sheetCounterId.trim();
      credentials.conversionLabel = sheetToken.trim();
    } else if (sheetProvider === "meta") {
      credentials.pixelId = sheetCounterId.trim();
      credentials.accessToken = sheetToken.trim();
      if (sheetTestEventCode.trim()) {
        credentials.testEventCode = sheetTestEventCode.trim();
      }
    } else if (sheetProvider === "vk") {
      credentials.pixelId = sheetCounterId.trim();
      credentials.accessToken = sheetToken.trim();
    }

    try {
      if (editingItem?.id) {
        await updateMutation.mutateAsync({
          id: editingItem.id,
          payload: {
            name: sheetName.trim(),
            siteName: sheetName.trim(),
            siteUrl: sheetSiteUrl.trim() || null,
            counterId: sheetCounterId.trim(),
            isActive: sheetIsActive,
            credentials,
            config: credentials,
            eventRules: sheetEventRules,
          },
        });
        toast.success(`Настройки счётчика «${sheetName}» обновлены`);
      } else {
        await createMutation.mutateAsync({
          provider: sheetProvider,
          name: sheetName.trim(),
          siteName: sheetName.trim(),
          siteUrl: sheetSiteUrl.trim() || null,
          counterId: sheetCounterId.trim(),
          isActive: sheetIsActive,
          credentials,
          config: credentials,
          eventRules: sheetEventRules,
        });
        toast.success(`Счётчик «${sheetName}» успешно подключён`);
      }

      setIsSheetOpen(false);
      void refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка при сохранении счётчика");
    }
  };

  const handleToggleActive = async (item: AnalyticsIntegrationDTO) => {
    try {
      await updateMutation.mutateAsync({
        id: item.id,
        payload: {
          isActive: !item.isActive,
        },
      });
      toast.success(
        item.isActive ? `Счётчик «${item.name || item.siteName}» отключён` : `Счётчик «${item.name || item.siteName}» активирован`,
      );
      void refetch();
    } catch {
      toast.error("Не удалось изменить статус активности");
    }
  };

  const handleDelete = async (item: AnalyticsIntegrationDTO) => {
    if (!confirm(`Удалить подключение «${item.name || item.siteName}»?`)) return;

    try {
      await deleteMutation.mutateAsync(item.id);
      toast.success(`Счётчик «${item.name || item.siteName}» удалён`);
      void refetch();
    } catch {
      toast.error("Не удалось удалить счётчик");
    }
  };

  const handleTest = async (item: AnalyticsIntegrationDTO) => {
    setTestingId(item.id);
    try {
      const res = await testMutation.mutateAsync(item.id);
      const isSuccess = res.status >= 200 && res.status < 300;
      setTestResults((prev) => ({
        ...prev,
        [item.id]: {
          success: isSuccess,
          status: res.status,
          message: isSuccess
            ? (res.responseSnippet || `Конверсия доставлена (HTTP ${res.status})`)
            : `Ошибка доставки (HTTP ${res.status}): ${res.error || "Проверьте токены"}`,
        },
      }));

      if (isSuccess) {
        toast.success(res.responseSnippet || `Счётчик успешно проверен`);
      } else {
        toast.error(`Ответ ${res.status}: ${res.error || "Ошибка авторизации или ID"}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Сбой отправки тестового события");
    } finally {
      setTestingId(null);
    }
  };

  const handleCopyGoal = (identifier: string) => {
    void navigator.clipboard.writeText(identifier);
    setCopiedGoal(identifier);
    toast.success(`Идентификатор «${identifier}» скопирован`);
    setTimeout(() => {
      setCopiedGoal((current) => (current === identifier ? null : current));
    }, 2000);
  };

  const copyToClipboard = (text: string, label: string) => {
    void navigator.clipboard.writeText(text);
    toast.success(`${label} скопирован в буфер обмена`);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full rounded-[8px]" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="h-44 w-full rounded-[8px]" />
          <Skeleton className="h-44 w-full rounded-[8px]" />
        </div>
      </div>
    );
  }

  const activeCount = integrations.filter((i) => i.isActive).length;

  return (
    <div className="space-y-6">
      {/* Верхний тулбар: сводка, фильтры сайтов, поиск и кнопка добавления */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[#e5e5e5] pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedSiteFilter("all")}
            className={`rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors ${
              selectedSiteFilter === "all"
                ? "bg-[#4a38f5] text-white shadow-2xs"
                : "border border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#fafafa] hover:text-[#111111]"
            }`}
          >
            Все сайты ({integrations.length})
          </button>
          {uniqueSites.map((site) => (
            <button
              key={site}
              type="button"
              onClick={() => setSelectedSiteFilter(site)}
              className={`rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors ${
                selectedSiteFilter === site
                  ? "bg-[#4a38f5] text-white shadow-2xs"
                  : "border border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#fafafa] hover:text-[#111111]"
              }`}
            >
              {site}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по сайту или ID..."
              className="h-8 w-44 sm:w-56 rounded-[8px] border border-[#e5e5e5] bg-white pl-8 pr-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-hidden focus:ring-1 focus:ring-[#4a38f5]/20"
            />
          </div>

          <button
            type="button"
            onClick={() => openCreateSheet()}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-[#3d2ee0] shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Добавить счётчик / пиксель</span>
          </button>
        </div>
      </div>

      {/* Информационная строка */}
      <div className="flex items-center justify-between text-xs text-[#666666]">
        <div>
          Активно подключений: <span className="font-semibold text-[#111111]">{activeCount}</span> из{" "}
          <span className="font-semibold text-[#111111]">{integrations.length}</span>
        </div>
        <div className="flex items-center gap-2 text-[#888888]">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          <span>Все токены защищены аппаратным шифрованием (AES-256-GCM)</span>
        </div>
      </div>

      {/* Состояние пустого списка */}
      {filteredIntegrations.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[12px] border border-dashed border-[#e5e5e5] bg-[#fafafa]/50 p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-[#4a38f5]">
            <Radio className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-[14px] font-semibold text-[#111111]">
            {searchQuery || selectedSiteFilter !== "all"
              ? "По заданным фильтрам счётчики не найдены"
              : "Нет подключенных счётчиков и пикселей"}
          </h3>
          <p className="mt-1.5 max-w-md text-xs text-[#666666]">
            Подключите Яндекс Метрику, Google Analytics 4, Meta Pixel или VK Рекламу для ваших лендингов и сайтов. Серверные конверсии отправляются в фоновом режиме даже при блокировщиках рекламы.
          </p>
          <div className="mt-5 flex flex-wrap gap-2 justify-center">
            {PROVIDERS_CATALOG.map((p) => (
              <button
                key={p.provider}
                type="button"
                onClick={() => openCreateSheet(p.provider)}
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs hover:border-[#cccccc] hover:bg-[#fafafa] transition-colors"
              >
                <Plus className="h-3 w-3 text-[#4a38f5]" />
                <span>+ {p.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* Сетка карточек активных подключений */
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filteredIntegrations.map((item) => {
            const canonical = normalizeAnalyticsProvider(item.provider);
            const meta = PROVIDERS_CATALOG.find((p) => p.provider === canonical);
            const isTesting = testingId === item.id;
            const testResult = testResults[item.id];
            const rules = item.eventRules || { onLeadCreated: true, onDealWon: true, onFirstMessage: true };

            return (
              <div
                key={item.id}
                className="flex flex-col justify-between rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs transition-colors hover:border-[#cccccc]"
              >
                <div className="space-y-3">
                  {/* Шапка карточки */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-[6px] border border-[#e5e5e5] bg-[#fafafa]">
                        {canonical === "yandex" && <BarChart3 className="h-4 w-4 text-red-600" />}
                        {canonical === "ga4" && <BarChart3 className="h-4 w-4 text-amber-500" />}
                        {canonical === "google_ads" && <Megaphone className="h-4 w-4 text-sky-600" />}
                        {canonical === "meta" && <Globe className="h-4 w-4 text-blue-600" />}
                        {canonical === "vk" && <Share2 className="h-4 w-4 text-blue-500" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-[13px] font-semibold text-[#111111]">
                            {item.name || item.siteName || "Сайт"}
                          </h4>
                          <span className="rounded-[4px] bg-[#f5f5f5] px-1.5 py-0.5 text-[10px] font-medium text-[#666666]">
                            {meta?.name || canonical}
                          </span>
                        </div>
                        {item.siteUrl && (
                          <a
                            href={item.siteUrl.startsWith("http") ? item.siteUrl : `https://${item.siteUrl}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-[#666666] hover:text-[#4a38f5] hover:underline"
                          >
                            <span>{item.siteUrl.replace(/^https?:\/\//, "")}</span>
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <TagPill color={item.isActive ? "emerald" : "slate"}>
                        {item.isActive ? "Активен" : "Отключен"}
                      </TagPill>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={item.isActive}
                        aria-label={item.isActive ? `Отключить ${item.name || item.siteName}` : `Активировать ${item.name || item.siteName}`}
                        onClick={() => handleToggleActive(item)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden focus:ring-2 focus:ring-[#4a38f5]/20 ${
                          item.isActive ? "bg-[#4a38f5]" : "bg-[#e5e5e5]"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                            item.isActive ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Идентификаторы и правила событий */}
                  <div className="rounded-[6px] bg-[#fbfbfb] p-2.5 border border-[#f0f0f0] space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#666666] font-medium">{meta?.counterLabel.split(" ")[0] || "ID"}:</span>
                      <div className="flex items-center gap-1.5 font-mono text-[11px] text-[#111111]">
                        <span>{item.counterId || "—"}</span>
                        {item.counterId && (
                          <button
                            type="button"
                            onClick={() => copyToClipboard(item.counterId!, "ID счётчика")}
                            className="text-[#888888] hover:text-[#111111] cursor-pointer"
                            title="Скопировать"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Фильтры событий */}
                    <div className="flex items-center gap-1.5 pt-1 border-t border-[#f0f0f0] text-[10px]">
                      <span className="text-[#888888] mr-1">События:</span>
                      <span
                        className={`rounded-[4px] px-1.5 py-0.5 font-medium ${
                          rules.onLeadCreated !== false
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-[#f5f5f5] text-[#888888]"
                        }`}
                      >
                        Лид
                      </span>
                      <span
                        className={`rounded-[4px] px-1.5 py-0.5 font-medium ${
                          rules.onDealWon !== false
                            ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                            : "bg-[#f5f5f5] text-[#888888]"
                        }`}
                      >
                        Продажа
                      </span>
                      <span
                        className={`rounded-[4px] px-1.5 py-0.5 font-medium ${
                          rules.onFirstMessage !== false
                            ? "bg-sky-50 text-sky-700 border border-sky-200"
                            : "bg-[#f5f5f5] text-[#888888]"
                        }`}
                      >
                        Чат
                      </span>
                    </div>
                  </div>

                  {/* Результат тестовой отправки */}
                  {testResult && (
                    <div
                      className={`flex items-start gap-2 rounded-[6px] p-2.5 text-[11px] ${
                        testResult.success
                          ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                          : "bg-rose-50 text-rose-800 border border-rose-200"
                      }`}
                    >
                      {testResult.success ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 space-y-1">
                        <div className="font-medium leading-snug">{testResult.message}</div>
                        {!testResult.success && canonical === "yandex" && (
                          <div className="text-[10px] text-rose-700/90 leading-relaxed border-t border-rose-200/60 pt-1 mt-1">
                            Рекомендация: проверьте номер счётчика и наличие OAuth-токена с правами metrika:read и metrika:write в настройках.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Действия карточки */}
                <div className="mt-4 flex items-center justify-between border-t border-[#f0f0f0] pt-3 text-xs">
                  <button
                    type="button"
                    onClick={() => handleTest(item)}
                    disabled={isTesting || !item.isActive}
                    className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-medium text-[#111111] shadow-2xs hover:border-[#cccccc] hover:bg-[#fafafa] disabled:opacity-40 transition-colors cursor-pointer"
                  >
                    {isTesting ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin text-[#4a38f5]" />
                        <span>Отправка...</span>
                      </>
                    ) : (
                      <>
                        <Send className="h-3 w-3 text-[#666666]" />
                        <span>Тест</span>
                      </>
                    )}
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEditSheet(item)}
                      className="inline-flex items-center gap-1 rounded-[6px] p-1.5 text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
                      title="Настроить"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(item)}
                      className="inline-flex items-center gap-1 rounded-[6px] p-1.5 text-rose-500 hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer"
                      title="Удалить"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Выдвижная шторка (Sheet) для добавления / редактирования счётчика */}
      <Sheet open={isSheetOpen} onClose={() => setIsSheetOpen(false)} width="w-[520px]">
        <SheetHeader onClose={() => setIsSheetOpen(false)}>
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-[#4a38f5]" />
            <span className="font-semibold text-[14px] text-[#111111]">
              {editingItem ? "Настройка счётчика аналитики" : "Подключение нового счётчика"}
            </span>
          </div>
        </SheetHeader>

        <SheetContent className="p-6 space-y-6">
          {/* Выбор провайдера (только для новых, для редактирования можно переключить) */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-[#666666]">Провайдер веб-аналитики</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PROVIDERS_CATALOG.map((p) => {
                const isSelected = sheetProvider === p.provider;
                return (
                  <button
                    key={p.provider}
                    type="button"
                    onClick={() => setSheetProvider(p.provider)}
                    className={`flex flex-col items-start gap-1 rounded-[8px] border p-2.5 text-left transition-colors cursor-pointer ${
                      isSelected
                        ? "border-[#4a38f5] bg-indigo-50/40 text-[#111111]"
                        : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:bg-[#fafafa]"
                    }`}
                  >
                    <span className="text-xs font-semibold">{p.name}</span>
                    <span className="text-[10px] text-[#888888] line-clamp-1">{p.badge}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Название сайта и URL */}
          <div className="space-y-4 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa]/40 p-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#111111]">
                Название сайта / проекта <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={sheetName}
                onChange={(e) => setSheetName(e.target.value)}
                placeholder="Например: Основной сайт mpro.ru или Лендинг звука"
                className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-hidden focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#111111]">
                Адрес сайта (домен или URL)
              </label>
              <input
                type="text"
                value={sheetSiteUrl}
                onChange={(e) => setSheetSiteUrl(e.target.value)}
                placeholder="https://mpro.ru"
                className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-hidden focus:ring-1 focus:ring-[#4a38f5]/20"
              />
              <p className="text-[11px] text-[#888888]">
                Используется для маршрутизации: конверсии отправляются в этот счётчик, если лид пришёл с указанного сайта.
              </p>
            </div>
          </div>

          {/* Параметры подключения провайдера */}
          {(() => {
            const meta = PROVIDERS_CATALOG.find((p) => p.provider === sheetProvider)!;
            return (
              <div className="space-y-4 rounded-[8px] border border-[#e5e5e5] bg-white p-4">
                <div className="border-b border-[#f0f0f0] pb-2">
                  <h4 className="text-xs font-semibold text-[#111111]">Параметры {meta.name}</h4>
                  <p className="text-[11px] text-[#666666]">{meta.description}</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[#111111]">
                    {meta.counterLabel} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={sheetCounterId}
                    onChange={(e) => setSheetCounterId(e.target.value)}
                    placeholder={meta.counterPlaceholder}
                    className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-hidden focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[#111111]">{meta.tokenLabel}</label>
                  <input
                    type="password"
                    value={sheetToken}
                    onChange={(e) => setSheetToken(e.target.value)}
                    placeholder={meta.tokenPlaceholder}
                    className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-hidden focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                  <p className="text-[10px] text-[#888888]">
                    {editingItem && sheetToken.includes("***")
                      ? "Токен сохранён в зашифрованном виде. Оставьте как есть, чтобы не менять."
                      : "Токен надёжно шифруется и используется только для серверных вызовов."}
                  </p>
                </div>

                {sheetProvider === "yandex" && (
                  <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[#111111]">
                        <KeyRound className="h-3.5 w-3.5 text-[#4a38f5]" />
                        <span>Инструкция: как получить OAuth-токен Яндекс</span>
                      </div>
                      <a
                        href="https://oauth.yandex.ru/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[#4a38f5] hover:underline"
                      >
                        <span>oauth.yandex.ru</span>
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </div>
                    <ol className="list-decimal list-inside space-y-1.5 text-[11px] text-[#666666] leading-relaxed">
                      <li>
                        Войдите в Яндекс под аккаунтом владельца счётчика и перейдите на{" "}
                        <a
                          href="https://oauth.yandex.ru/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-[#4a38f5] hover:underline"
                        >
                          oauth.yandex.ru
                        </a>
                        . Нажмите <span className="font-medium text-[#111111]">«Создать приложение»</span>.
                      </li>
                      <li>
                        В блоке <span className="font-medium text-[#111111]">«Платформы»</span> выберите{" "}
                        <span className="font-medium text-[#111111]">«Веб-сервисы»</span> и укажите Redirect URI:{" "}
                        <code className="rounded bg-black/[0.04] px-1 py-0.5 font-mono text-[10px] text-[#111111]">
                          https://oauth.yandex.ru/verification_code
                        </code>
                      </li>
                      <li>
                        В разделе <span className="font-medium text-[#111111]">«Доступ к данным»</span> найдите{" "}
                        <span className="font-medium text-[#111111]">«Яндекс Метрика»</span> и отметьте права:
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className="rounded-[4px] border border-[#e5e5e5] bg-white px-1.5 py-0.5 font-mono text-[10px] text-[#111111]">
                            metrika:read (чтение)
                          </span>
                          <span className="rounded-[4px] border border-[#e5e5e5] bg-white px-1.5 py-0.5 font-mono text-[10px] text-[#111111]">
                            metrika:write (запись конверсий)
                          </span>
                        </div>
                      </li>
                      <li>
                        Сохраните приложение и получите токен авторизации (начинается на{" "}
                        <code className="font-mono font-semibold text-[#111111]">y0_...</code>).
                      </li>
                    </ol>
                  </div>
                )}

                {meta.hasTestEventCode && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[#111111]">Test Event Code (опционально)</label>
                    <input
                      type="text"
                      value={sheetTestEventCode}
                      onChange={(e) => setSheetTestEventCode(e.target.value)}
                      placeholder="Например: TEST12345"
                      className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-hidden focus:ring-1 focus:ring-[#4a38f5]/20"
                    />
                  </div>
                )}
              </div>
            );
          })()}

          {/* Цели в Яндекс Метрике (JavaScript-события) */}
          {sheetProvider === "yandex" && (
            <div className="space-y-3 rounded-[8px] border border-[#e5e5e5] bg-white p-4">
              <div className="border-b border-[#f0f0f0] pb-2">
                <div className="flex items-center gap-1.5">
                  <Target className="h-4 w-4 text-[#4a38f5]" />
                  <h4 className="text-xs font-semibold text-[#111111]">
                    Цели в Яндекс Метрике (JavaScript-события)
                  </h4>
                </div>
                <p className="mt-0.5 text-[11px] text-[#666666]">
                  Создайте в интерфейсе Яндекс Метрики цели с типом «JavaScript-событие» и скопируйте идентификаторы ниже:
                </p>
              </div>

              <div className="space-y-2.5">
                {YANDEX_GOALS.map((goal) => {
                  const isCopied = copiedGoal === goal.identifier;
                  return (
                    <div
                      key={goal.id}
                      className="rounded-[6px] border border-[#e5e5e5] bg-[#fbfbfb] p-3 space-y-1.5 transition-colors hover:border-[#cccccc]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-[#111111]">{goal.name}</span>
                          <span className="rounded-[4px] bg-[#f0f0f0] px-1.5 py-0.5 text-[10px] font-medium text-[#666666]">
                            {goal.type}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyGoal(goal.identifier)}
                          className={`inline-flex items-center gap-1 rounded-[6px] border px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                            isCopied
                              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                              : "border-[#e5e5e5] bg-white text-[#111111] hover:border-[#cccccc] hover:bg-[#fafafa]"
                          }`}
                        >
                          {isCopied ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-600" />
                              <span>Скопировано</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3 text-[#666666]" />
                              <span>Скопировать</span>
                            </>
                          )}
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-[#666666]">Идентификатор цели:</span>
                        <code className="rounded-[4px] border border-[#e5e5e5] bg-white px-2 py-0.5 font-mono text-xs font-semibold text-[#4a38f5]">
                          {goal.identifier}
                        </code>
                        {goal.aliases.length > 0 && (
                          <span className="text-[10px] text-[#888888]">
                            (алиасы: {goal.aliases.join(", ")})
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-[#666666] leading-relaxed">
                        {goal.triggerCondition}
                      </p>
                      <div className="text-[10px] text-[#888888]">
                        Данные: {goal.payloadInfo}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Правила отправки конверсий (Event Rules) */}
          <div className="space-y-3 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa]/30 p-4">
            <h4 className="text-xs font-semibold text-[#111111]">События и воронки</h4>
            <div className="space-y-2 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sheetEventRules.onLeadCreated}
                  onChange={(e) =>
                    setSheetEventRules((prev) => ({ ...prev, onLeadCreated: e.target.checked }))
                  }
                  className="rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5]"
                />
                <span className="text-[#111111]">Создание лида (Lead / submit_lead)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sheetEventRules.onDealWon}
                  onChange={(e) =>
                    setSheetEventRules((prev) => ({ ...prev, onDealWon: e.target.checked }))
                  }
                  className="rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5]"
                />
                <span className="text-[#111111]">Успешная продажа (Purchase / выиграна)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sheetEventRules.onFirstMessage}
                  onChange={(e) =>
                    setSheetEventRules((prev) => ({ ...prev, onFirstMessage: e.target.checked }))
                  }
                  className="rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5]"
                />
                <span className="text-[#111111]">Первое сообщение в чат / мессенджер (Chat)</span>
              </label>
            </div>
          </div>

          {/* Переключатель активности */}
          <div className="flex items-center justify-between rounded-[8px] border border-[#e5e5e5] bg-white p-3">
            <div>
              <div className="text-xs font-semibold text-[#111111]">Активность счётчика</div>
              <div className="text-[11px] text-[#666666]">
                Включите передачу данных, чтобы серверные конверсии отправлялись в фоновом режиме
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSheetIsActive(!sheetIsActive)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                sheetIsActive ? "bg-[#4a38f5]" : "bg-[#e5e5e5]"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                  sheetIsActive ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Кнопки действий */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsSheetOpen(false)}
              className="rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-2 text-xs font-medium text-[#666666] hover:bg-[#fafafa] hover:text-[#111111] transition-colors cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleSaveSheet}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-[#3d2ee0] disabled:opacity-50 transition-colors cursor-pointer"
            >
              {(createMutation.isPending || updateMutation.isPending) && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              <span>{editingItem ? "Сохранить изменения" : "Подключить счётчик"}</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
