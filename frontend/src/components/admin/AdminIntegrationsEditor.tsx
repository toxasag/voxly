"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  FileText,
  Key,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Server,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import {
  type AdminIntegrationsConfigDTO,
  type AdminLlmProviderDTO,
  type AdminLlmProviderPayload,
  type LlmProviderType,
  useAdminIntegrationsConfig,
  useTestAdminLlm,
  useUpdateAdminIntegrationsConfig,
} from "@/lib/api/use-admin";
import { cn } from "@/lib/utils";

interface LocalProviderItem {
  id: string;
  name: string;
  providerType: LlmProviderType;
  baseUrl: string;
  keys: string[];
  chatModel: string;
  embeddingModel: string;
  isActive: boolean;
  isDefault: boolean;
  showBatchInput?: boolean;
  batchText?: string;
}

const PROVIDER_PRESETS: Record<
  LlmProviderType,
  {
    name: string;
    baseUrl: string;
    chatModel: string;
    embeddingModel: string;
    description: string;
  }
> = {
  gemini: {
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    chatModel: "gemini-2.0-flash",
    embeddingModel: "text-embedding-004",
    description:
      "Официальный OpenAI-эндпоинт Google. Бесплатно до 15 RPM на ключ. 20 ключей в пуле дают суммарно до 300 RPM.",
  },
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    chatModel: "gpt-4o-mini",
    embeddingModel: "text-embedding-3-small",
    description: "Оригинальный OpenAI API с моделями GPT-4o-mini и эмбеддингами 1536d.",
  },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    chatModel: "deepseek-chat",
    embeddingModel: "text-embedding-3-small",
    description: "Высокоэффективные и экономичные модели DeepSeek V3 / R1.",
  },
  openrouter: {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    chatModel: "openai/gpt-4o-mini",
    embeddingModel: "text-embedding-3-small",
    description: "Универсальный агрегатор всех мировых нейросетей через один API-ключ.",
  },
  custom: {
    name: "Свой провайдер (Custom)",
    baseUrl: "",
    chatModel: "gpt-4o-mini",
    embeddingModel: "text-embedding-3-small",
    description: "Любой совместимый с OpenAI API шлюз (vLLM, Ollama, LiteLLM, локальный прокси).",
  },
};

export function AdminIntegrationsEditor() {
  const { data, isLoading, isError, error } = useAdminIntegrationsConfig();
  const updateMutation = useUpdateAdminIntegrationsConfig();
  const testLlmMutation = useTestAdminLlm();

  // Robokassa state
  const [merchantLogin, setMerchantLogin] = useState("");
  const [password1Value, setPassword1Value] = useState("");
  const [password2Value, setPassword2Value] = useState("");
  const [showPass1, setShowPass1] = useState(false);
  const [showPass2, setShowPass2] = useState(false);
  const [isTestMode, setIsTestMode] = useState(true);
  const [hashAlgo, setHashAlgo] = useState<"SHA256" | "MD5">("SHA256");
  const [tax, setTax] = useState("none");

  // Multi-provider LLM state
  const [providers, setProviders] = useState<LocalProviderItem[]>([]);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);

  // Sync state from query data
  useEffect(() => {
    if (!data) return;

    // Robokassa
    setMerchantLogin(data.robokassa.merchantLogin || "");
    setPassword1Value(data.robokassa.hasPassword1 ? "••••••••••••" : "");
    setPassword2Value(data.robokassa.hasPassword2 ? "••••••••••••" : "");
    setIsTestMode(data.robokassa.isTest);
    setHashAlgo(data.robokassa.hashAlgo === "MD5" ? "MD5" : "SHA256");
    setTax(data.robokassa.tax || "none");

    // LLM Providers
    if (data.llmProviders && data.llmProviders.length > 0) {
      setProviders(
        data.llmProviders.map((p) => ({
          id: p.id,
          name: p.name,
          providerType: p.providerType,
          baseUrl: p.baseUrl,
          keys: p.maskedKeys.length > 0 ? p.maskedKeys : [],
          chatModel: p.chatModel,
          embeddingModel: p.embeddingModel,
          isActive: p.isActive,
          isDefault: p.isDefault,
        })),
      );
    } else {
      // Начальный список: если есть legacy ключ — формируем его, иначе добавляем Gemini как дефолт
      const initialKeys = data.llm.hasApiKey ? ["••••••••••••••••••••"] : [];
      setProviders([
        {
          id: "prov-gemini",
          name: "Google Gemini",
          providerType: "gemini",
          baseUrl:
            data.llm.baseUrl && data.llm.baseUrl.includes("generativelanguage")
              ? data.llm.baseUrl
              : "https://generativelanguage.googleapis.com/v1beta/openai",
          keys: initialKeys,
          chatModel: data.llm.chatModel || "gemini-2.0-flash",
          embeddingModel: data.llm.embeddingModel || "text-embedding-004",
          isActive: true,
          isDefault: true,
        },
      ]);
    }
  }, [data]);

  const handleSaveRobokassa = async () => {
    try {
      const payload: {
        merchantLogin: string;
        isTest: boolean;
        hashAlgo: "SHA256" | "MD5";
        tax: string;
        password1?: string;
        password2?: string;
      } = {
        merchantLogin,
        isTest: isTestMode,
        hashAlgo,
        tax,
      };

      if (password1Value && !password1Value.includes("•")) {
        payload.password1 = password1Value;
      }
      if (password2Value && !password2Value.includes("•")) {
        payload.password2 = password2Value;
      }

      await updateMutation.mutateAsync({ robokassa: payload });
      toast.success("Настройки Robokassa успешно сохранены");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить настройки Robokassa");
    }
  };

  const handleSaveLlmProviders = async () => {
    try {
      const payloadProviders: AdminLlmProviderPayload[] = providers.map((p) => ({
        id: p.id,
        name: p.name,
        providerType: p.providerType,
        baseUrl: p.baseUrl,
        apiKeys: p.keys,
        chatModel: p.chatModel,
        embeddingModel: p.embeddingModel,
        isActive: p.isActive,
        isDefault: p.isDefault,
      }));

      await updateMutation.mutateAsync({ llmProviders: payloadProviders });
      toast.success("Настройки ИИ-провайдеров и пулов ключей успешно сохранены");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить ИИ-провайдеров");
    }
  };

  const handleTestProvider = async (provider: LocalProviderItem) => {
    setTestingProviderId(provider.id);
    try {
      const firstKey = provider.keys[0];
      const payload: { baseUrl?: string; apiKey?: string } = {
        baseUrl: provider.baseUrl,
      };

      // Если ключ не маскированный, передаём для проверки. Если маскированный — сервер проверит из базы
      if (firstKey && !firstKey.includes("•")) {
        payload.apiKey = firstKey;
      }

      const res = await testLlmMutation.mutateAsync(payload);
      if (res.success) {
        toast.success(
          `Связь с «${provider.name}» установлена${res.modelsCount ? ` (доступно моделей: ${res.modelsCount})` : ""}`,
        );
      } else {
        toast.error(`Ошибка проверки «${provider.name}»: ${res.message}`);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось проверить соединение с провайдером");
    } finally {
      setTestingProviderId(null);
    }
  };

  const handleAddProvider = (type: LlmProviderType = "gemini") => {
    const preset = PROVIDER_PRESETS[type];
    const newId = `prov-${type}-${Date.now().toString(36)}`;
    const newProvider: LocalProviderItem = {
      id: newId,
      name: preset.name,
      providerType: type,
      baseUrl: preset.baseUrl,
      keys: [],
      chatModel: preset.chatModel,
      embeddingModel: preset.embeddingModel,
      isActive: true,
      isDefault: providers.length === 0,
      showBatchInput: type === "gemini",
    };
    setProviders([...providers, newProvider]);
    toast.info(`Добавлен блок: ${preset.name}`);
  };

  const handleRemoveProvider = (id: string) => {
    if (providers.length <= 1) {
      toast.error("Должен оставаться хотя бы один ИИ-провайдер");
      return;
    }
    const filtered = providers.filter((p) => p.id !== id);
    if (!filtered.some((p) => p.isDefault) && filtered.length > 0) {
      filtered[0].isDefault = true;
    }
    setProviders(filtered);
    toast.success("Провайдер удален");
  };

  const handleSetDefaultProvider = (id: string) => {
    setProviders(
      providers.map((p) => ({
        ...p,
        isDefault: p.id === id,
      })),
    );
  };

  const handleApplyPreset = (providerId: string, type: LlmProviderType) => {
    const preset = PROVIDER_PRESETS[type];
    setProviders(
      providers.map((p) => {
        if (p.id !== providerId) return p;
        return {
          ...p,
          name: preset.name,
          providerType: type,
          baseUrl: preset.baseUrl,
          chatModel: preset.chatModel,
          embeddingModel: preset.embeddingModel,
        };
      }),
    );
    toast.info(`Применен пресет: ${preset.name}`);
  };

  // Работа с пулом ключей провайдера
  const handleAddSingleKey = (providerId: string, keyVal: string) => {
    const trimmed = keyVal.trim();
    if (!trimmed) return;
    setProviders(
      providers.map((p) => {
        if (p.id !== providerId) return p;
        return {
          ...p,
          keys: [...p.keys, trimmed],
        };
      }),
    );
  };

  const handleRemoveKey = (providerId: string, keyIndex: number) => {
    setProviders(
      providers.map((p) => {
        if (p.id !== providerId) return p;
        const nextKeys = [...p.keys];
        nextKeys.splice(keyIndex, 1);
        return {
          ...p,
          keys: nextKeys,
        };
      }),
    );
  };

  const handleApplyBatchKeys = (
    providerId: string,
    batchRawText: string,
    replaceExisting: boolean,
  ) => {
    const lines = batchRawText
      .split(/[\r\n,]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (lines.length === 0) {
      toast.error("Не найдено ни одного валидного ключа для добавления");
      return;
    }

    setProviders(
      providers.map((p) => {
        if (p.id !== providerId) return p;
        const nextKeys = replaceExisting ? lines : [...p.keys, ...lines];
        return {
          ...p,
          keys: nextKeys,
          showBatchInput: false,
          batchText: "",
        };
      }),
    );

    toast.success(
      replaceExisting
        ? `Пул ключей заменен: добавлено ${lines.length} шт.`
        : `В пул добавлено ${lines.length} новых ключей`,
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-[#4a38f5]" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-[8px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Не удалось загрузить настройки интеграций: {error?.message}
      </div>
    );
  }

  const isRoboConfigured = data?.robokassa.isConfigured ?? false;
  const totalKeysCount = providers.reduce((acc, p) => acc + p.keys.length, 0);

  return (
    <div className="space-y-6">
      {/* 1. Блок Robokassa */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#f0f0f0] pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-[#4a38f5]">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-[#111111]">Платёжный шлюз Robokassa</h2>
                {isRoboConfigured ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="h-3 w-3" />
                    Подключен
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                    <AlertCircle className="h-3 w-3" />
                    Не настроен
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-[#666666]">
                Приём оплат картами, СБП и выставление счетов по 54-ФЗ
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSaveRobokassa}
            disabled={updateMutation.isPending}
            className="flex items-center gap-2 rounded-[8px] bg-[#4a38f5] px-4 py-2 text-[13px] font-medium text-white shadow-2xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50"
          >
            {updateMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Сохранить ключи Robokassa
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* Merchant Login */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#111111]">
              Идентификатор магазина (Merchant Login) *
            </label>
            <input
              type="text"
              value={merchantLogin}
              onChange={(e) => setMerchantLogin(e.target.value)}
              placeholder="Например: getvoxly"
              className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
            <p className="text-[11px] text-[#888888]">
              Логин магазина из личного кабинета Robokassa
            </p>
          </div>

          {/* Test mode toggle */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#111111]">Режим работы шлюза</label>
            <div className="flex h-8 items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-[#111111] cursor-pointer">
                <input
                  type="checkbox"
                  checked={isTestMode}
                  onChange={(e) => setIsTestMode(e.target.checked)}
                  className="rounded border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5]"
                />
                Тестовый режим (платежи проводятся тестовыми картами без списания)
              </label>
            </div>
            <p className="text-[11px] text-[#888888]">
              Снимите галочку перед запуском реальных денежных платежей
            </p>
          </div>

          {/* Password #1 */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#111111]">
              Пароль #1 (генерация ссылки на оплату) *
            </label>
            <div className="relative">
              <input
                type={showPass1 ? "text" : "password"}
                value={password1Value}
                onChange={(e) => setPassword1Value(e.target.value)}
                placeholder="Введите Пароль #1"
                className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 pr-9 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
              <button
                type="button"
                onClick={() => setShowPass1(!showPass1)}
                className="absolute right-2.5 top-2 text-[#888888] hover:text-[#111111]"
              >
                {showPass1 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[11px] text-[#888888]">
              Используется для подписи исходящих запросов на оплату счёта
            </p>
          </div>

          {/* Password #2 */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#111111]">
              Пароль #2 (верификация оповещений ResultURL) *
            </label>
            <div className="relative">
              <input
                type={showPass2 ? "text" : "password"}
                value={password2Value}
                onChange={(e) => setPassword2Value(e.target.value)}
                placeholder="Введите Пароль #2"
                className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 pr-9 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
              <button
                type="button"
                onClick={() => setShowPass2(!showPass2)}
                className="absolute right-2.5 top-2 text-[#888888] hover:text-[#111111]"
              >
                {showPass2 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[11px] text-[#888888]">
              Используется для проверки подлинности входящих вебхуков об оплате
            </p>
          </div>

          {/* Hash Algo */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#111111]">Алгоритм расчёта хеша</label>
            <select
              value={hashAlgo}
              onChange={(e) => setHashAlgo(e.target.value as "SHA256" | "MD5")}
              className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-[13px] text-[#111111] focus:border-[#4a38f5] focus:outline-none"
            >
              <option value="SHA256">SHA256 (рекомендуется)</option>
              <option value="MD5">MD5 (устаревший)</option>
            </select>
          </div>

          {/* Tax rate */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#111111]">Налоговая ставка по 54-ФЗ</label>
            <select
              value={tax}
              onChange={(e) => setTax(e.target.value)}
              className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-[13px] text-[#111111] focus:border-[#4a38f5] focus:outline-none"
            >
              <option value="none">Без НДС (УСН/Патент)</option>
              <option value="vat0">НДС 0%</option>
              <option value="vat10">НДС 10%</option>
              <option value="vat20">НДС 20%</option>
            </select>
          </div>
        </div>

        {/* URL callbacks info */}
        <div className="mt-5 rounded-[8px] bg-[#fafafa] p-4 border border-[#f0f0f0]">
          <p className="text-xs font-semibold text-[#111111]">Параметры для личного кабинета Robokassa:</p>
          <div className="mt-2 space-y-1 font-mono text-xs text-[#555555]">
            <p>
              <span className="font-semibold text-[#111111]">ResultURL:</span>{" "}
              https://api.getvoxly.ru/api/v1/billing/robokassa/result (метод POST)
            </p>
            <p>
              <span className="font-semibold text-[#111111]">SuccessURL:</span>{" "}
              https://app.getvoxly.ru/finance?payment=success (метод GET)
            </p>
            <p>
              <span className="font-semibold text-[#111111]">FailURL:</span>{" "}
              https://app.getvoxly.ru/finance?payment=cancelled (метод GET)
            </p>
          </div>
        </div>
      </div>

      {/* 2. Блок ИИ-провайдеров и пула API-ключей */}
      <div className="space-y-4">
        {/* Шапка секции провайдеров */}
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-[#4a38f5]">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-[#111111]">
                    ИИ-провайдеры (LLM & Embeddings)
                  </h2>
                  <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-[#4a38f5]">
                    <Zap className="h-3 w-3" />
                    Ключей в пулах: {totalKeysCount}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-[#666666]">
                  Несколько независимых провайдеров (Google Gemini, OpenAI, DeepSeek, OpenRouter) с
                  балансировкой Round-Robin и защитой от лимитов (429)
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Кнопка быстрого добавления Gemini */}
              <button
                type="button"
                onClick={() => handleAddProvider("gemini")}
                className="flex items-center gap-1.5 rounded-[8px] border border-sky-200 bg-sky-50 px-3 py-2 text-[13px] font-medium text-sky-700 shadow-2xs transition-colors hover:bg-sky-100"
              >
                <Plus className="h-4 w-4" />
                + Google Gemini
              </button>

              {/* Кнопка добавления другого провайдера */}
              <button
                type="button"
                onClick={() => handleAddProvider("openai")}
                className="flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] font-medium text-[#111111] shadow-2xs transition-colors hover:border-[#cccccc] hover:bg-[#fafafa]"
              >
                <Plus className="h-4 w-4" />
                + OpenAI / Другой
              </button>

              {/* Кнопка сохранения всех провайдеров */}
              <button
                type="button"
                onClick={handleSaveLlmProviders}
                disabled={updateMutation.isPending}
                className="flex items-center gap-2 rounded-[8px] bg-[#4a38f5] px-4 py-2 text-[13px] font-medium text-white shadow-2xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Сохранить всех провайдеров
              </button>
            </div>
          </div>
        </div>

        {/* Список карточек провайдеров */}
        {providers.map((provider, pIndex) => {
          const isTestingThis = testingProviderId === provider.id;
          const isGemini = provider.providerType === "gemini";

          return (
            <div
              key={provider.id}
              className={cn(
                "rounded-[8px] border bg-white p-6 shadow-2xs transition-all",
                provider.isDefault
                  ? "border-[#4a38f5]/40 ring-1 ring-[#4a38f5]/20"
                  : "border-[#e5e5e5]",
              )}
            >
              {/* Заголовок карточки провайдера */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#f0f0f0] pb-4">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-lg font-bold text-xs uppercase",
                      isGemini
                        ? "bg-sky-50 text-sky-700 border border-sky-200"
                        : "bg-neutral-100 text-[#111111]",
                    )}
                  >
                    {provider.providerType.slice(0, 3)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={provider.name}
                        onChange={(e) => {
                          const val = e.target.value;
                          setProviders(
                            providers.map((p) => (p.id === provider.id ? { ...p, name: val } : p)),
                          );
                        }}
                        className="h-7 rounded-[4px] border border-transparent px-1.5 text-base font-semibold text-[#111111] hover:border-[#e5e5e5] focus:border-[#4a38f5] focus:outline-none"
                      />
                      {provider.isDefault && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#4a38f5]/30 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-[#4a38f5]">
                          Основной (по умолчанию)
                        </span>
                      )}
                      {provider.keys.length > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" />
                          {provider.keys.length} {provider.keys.length === 1 ? "ключ" : "ключей"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                          <AlertCircle className="h-3 w-3" />
                          Нет ключей
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-[#666666]">
                      {PROVIDER_PRESETS[provider.providerType]?.description ||
                        "OpenAI-совместимый провайдер нейросетей"}
                    </p>
                  </div>
                </div>

                {/* Действия карточки */}
                <div className="flex items-center gap-2">
                  {/* Переключатель по умолчанию */}
                  {!provider.isDefault && (
                    <button
                      type="button"
                      onClick={() => handleSetDefaultProvider(provider.id)}
                      className="rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-medium text-[#555555] hover:border-[#4a38f5] hover:text-[#4a38f5] transition-colors"
                    >
                      Сделать основным
                    </button>
                  )}

                  {/* Активен */}
                  <label className="flex items-center gap-1.5 text-xs text-[#111111] cursor-pointer mr-2">
                    <input
                      type="checkbox"
                      checked={provider.isActive}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setProviders(
                          providers.map((p) =>
                            p.id === provider.id ? { ...p, isActive: val } : p,
                          ),
                        );
                      }}
                      className="rounded border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5]"
                    />
                    Активен
                  </label>

                  {/* Проверить связь */}
                  <button
                    type="button"
                    onClick={() => handleTestProvider(provider)}
                    disabled={isTestingThis || testLlmMutation.isPending}
                    className="flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs hover:border-[#cccccc] hover:bg-[#fafafa] disabled:opacity-50 transition-colors"
                  >
                    {isTestingThis ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
                    ) : (
                      <Server className="h-3.5 w-3.5 text-[#666666]" />
                    )}
                    Проверить связь
                  </button>

                  {/* Удалить */}
                  <button
                    type="button"
                    onClick={() => handleRemoveProvider(provider.id)}
                    className="p-1.5 text-[#888888] hover:text-rose-600 hover:bg-rose-50 rounded-[6px] transition-colors"
                    title="Удалить провайдера"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Быстрые пресеты для этой карточки */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs text-[#666666]">Сменить тип/пресет:</span>
                {(["gemini", "openai", "deepseek", "openrouter", "custom"] as LlmProviderType[]).map(
                  (type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleApplyPreset(provider.id, type)}
                      className={cn(
                        "rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors border",
                        provider.providerType === type
                          ? "border-[#4a38f5] bg-indigo-50 text-[#4a38f5]"
                          : "border-[#e5e5e5] bg-[#fafafa] text-[#111111] hover:border-[#cccccc] hover:bg-white",
                      )}
                    >
                      {PROVIDER_PRESETS[type].name}
                    </button>
                  ),
                )}
              </div>

              {/* Поля адреса и моделей */}
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                {/* Base URL */}
                <div className="space-y-1.5 md:col-span-1">
                  <label className="block text-xs font-medium text-[#111111]">
                    Базовый адрес API (Base URL) *
                  </label>
                  <input
                    type="text"
                    value={provider.baseUrl}
                    onChange={(e) => {
                      const val = e.target.value;
                      setProviders(
                        providers.map((p) =>
                          p.id === provider.id ? { ...p, baseUrl: val } : p,
                        ),
                      );
                    }}
                    placeholder="https://..."
                    className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] font-mono focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                  <p className="text-[11px] text-[#888888]">
                    OpenAI-совместимый эндпоинт провайдера
                  </p>
                </div>

                {/* Chat Model */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-[#111111]">
                    Модель чата / диалогов *
                  </label>
                  <input
                    type="text"
                    value={provider.chatModel}
                    onChange={(e) => {
                      const val = e.target.value;
                      setProviders(
                        providers.map((p) =>
                          p.id === provider.id ? { ...p, chatModel: val } : p,
                        ),
                      );
                    }}
                    placeholder="gemini-2.0-flash / gpt-4o-mini"
                    className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] font-mono focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                  <p className="text-[11px] text-[#888888]">
                    Для ответов AI-агентов в переписках
                  </p>
                </div>

                {/* Embedding Model */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-[#111111]">
                    Модель векторных эмбеддингов *
                  </label>
                  <input
                    type="text"
                    value={provider.embeddingModel}
                    onChange={(e) => {
                      const val = e.target.value;
                      setProviders(
                        providers.map((p) =>
                          p.id === provider.id ? { ...p, embeddingModel: val } : p,
                        ),
                      );
                    }}
                    placeholder="text-embedding-004 / text-embedding-3-small"
                    className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] font-mono focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                  <p className="text-[11px] text-[#888888]">
                    Используется базой знаний RAG
                  </p>
                </div>
              </div>

              {/* Блок пула API-ключей */}
              <div className="mt-5 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 text-[#4a38f5]" />
                    <span className="text-xs font-semibold text-[#111111]">
                      Пул API-ключей ({provider.keys.length} шт.)
                    </span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                      Round-Robin ротация + failover 429
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Кнопка открытия массовой вставки */}
                    <button
                      type="button"
                      onClick={() => {
                        setProviders(
                          providers.map((p) =>
                            p.id === provider.id
                              ? { ...p, showBatchInput: !p.showBatchInput }
                              : p,
                          ),
                        );
                      }}
                      className="flex items-center gap-1.5 rounded-[6px] border border-[#4a38f5]/30 bg-white px-2.5 py-1 text-xs font-medium text-[#4a38f5] hover:bg-indigo-50 shadow-2xs transition-colors"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      {provider.showBatchInput ? "Скрыть пачку" : "Вставить пачкой (списком)"}
                    </button>
                  </div>
                </div>

                {/* Форма массовой вставки 20 ключей */}
                {provider.showBatchInput && (
                  <div className="mt-3 rounded-[8px] border border-[#4a38f5]/20 bg-white p-4 shadow-xs space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-[#111111]">
                        Массовое добавление ключей (по одному ключу на строку):
                      </span>
                      <span className="text-[11px] text-[#666666]">
                        Например, скопируйте и вставьте 20 ключей Google AI Studio
                      </span>
                    </div>

                    <textarea
                      rows={6}
                      value={provider.batchText || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setProviders(
                          providers.map((p) =>
                            p.id === provider.id ? { ...p, batchText: val } : p,
                          ),
                        );
                      }}
                      placeholder={`AIzaSyA1234567890...\nAIzaSyB1234567890...\nAIzaSyC1234567890...\n(вставьте сюда ваши 20 ключей)`}
                      className="w-full rounded-[6px] border border-[#e5e5e5] p-2.5 font-mono text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                    />

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-[#666666]">
                        Распознано строк:{" "}
                        <span className="font-semibold text-[#111111]">
                          {(provider.batchText || "")
                            .split(/[\r\n]+/)
                            .filter((k) => k.trim().length > 0).length}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            handleApplyBatchKeys(provider.id, provider.batchText || "", false)
                          }
                          className="rounded-[6px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] hover:bg-[#fafafa] transition-colors"
                        >
                          Добавить к существующим
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleApplyBatchKeys(provider.id, provider.batchText || "", true)
                          }
                          className="rounded-[6px] bg-[#4a38f5] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#3d2ee0] transition-colors shadow-2xs"
                        >
                          Заменить весь пул ключей
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Список добавленных ключей пула */}
                <div className="mt-3 space-y-2">
                  {provider.keys.length === 0 ? (
                    <div className="rounded-[6px] border border-dashed border-[#e5e5e5] bg-white py-4 text-center text-xs text-[#888888]">
                      В пуле нет ни одного ключа. Нажмите кнопку «Вставить пачкой (списком)» и
                      добавьте 20 ключей.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                      {provider.keys.map((k, kIndex) => (
                        <div
                          key={`${provider.id}-k-${kIndex}`}
                          className="flex items-center justify-between rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 shadow-2xs"
                        >
                          <div className="flex items-center gap-2 overflow-hidden">
                            <span className="rounded bg-neutral-100 px-1 py-0.5 text-[10px] font-mono font-medium text-[#666666]">
                              #{kIndex + 1}
                            </span>
                            <span className="truncate font-mono text-xs text-[#111111]" title={k}>
                              {k}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveKey(provider.id, kIndex)}
                            className="p-1 text-[#888888] hover:text-rose-600 transition-colors"
                            title="Удалить ключ"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Одиночное добавление ключа внизу */}
                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="text"
                    id={`single-key-${provider.id}`}
                    placeholder="Быстрое добавление одного ключа: AIzaSy..."
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const target = e.currentTarget;
                        handleAddSingleKey(provider.id, target.value);
                        target.value = "";
                      }
                    }}
                    className="h-8 flex-1 rounded-[6px] border border-[#e5e5e5] bg-white px-3 text-xs font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.getElementById(
                        `single-key-${provider.id}`,
                      ) as HTMLInputElement | null;
                      if (el && el.value.trim()) {
                        handleAddSingleKey(provider.id, el.value.trim());
                        el.value = "";
                      }
                    }}
                    className="flex h-8 items-center gap-1 rounded-[6px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#fafafa] transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Добавить
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}