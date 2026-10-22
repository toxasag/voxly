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
  type LlmModelItem,
  type LlmProviderType,
  useAdminIntegrationsConfig,
  useFetchLlmModels,
  useTestAdminLlm,
  useUpdateAdminIntegrationsConfig,
  useVerifyLlmKeys,
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
  customChatModel?: boolean;
  customEmbeddingModel?: boolean;
  availableModels?: LlmModelItem[];
  isLoadingModels?: boolean;
  keyStatuses?: Record<
    number,
    { status: "valid" | "invalid"; message: string; statusCode?: number }
  >;
  isVerifyingKeys?: boolean;
  verifyingKeyIndex?: number | null;
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
    chatModel: "gemini-3.5-flash-lite",
    embeddingModel: "gemini-embedding-001",
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

const RECOMMENDED_CHAT_MODELS: Record<LlmProviderType, Array<{ id: string; name: string }>> = {
  gemini: [
    { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite (быстрая, экономичная, рекомендуется)" },
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash (универсальная)" },
    { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash (новейшая)" },
    { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
    { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash" },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview (сложные рассуждения)" },
    { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  ],
  openai: [
    { id: "gpt-4o-mini", name: "GPT-4o Mini (быстрая и экономичная)" },
    { id: "gpt-4o", name: "GPT-4o (флагманская)" },
    { id: "o1-mini", name: "o1 Mini (рассуждения)" },
  ],
  deepseek: [
    { id: "deepseek-chat", name: "DeepSeek V3 (Chat)" },
    { id: "deepseek-reasoner", name: "DeepSeek R1 (Reasoner)" },
  ],
  openrouter: [
    { id: "openai/gpt-4o-mini", name: "OpenAI: GPT-4o Mini" },
    { id: "anthropic/claude-3.5-sonnet", name: "Anthropic: Claude 3.5 Sonnet" },
    { id: "deepseek/deepseek-chat", name: "DeepSeek: V3" },
    { id: "google/gemini-2.5-pro", name: "Google: Gemini 2.5 Pro" },
  ],
  custom: [
    { id: "gpt-4o-mini", name: "gpt-4o-mini" },
    { id: "gpt-4o", name: "gpt-4o" },
  ],
};

const RECOMMENDED_EMBEDDING_MODELS: Record<LlmProviderType, Array<{ id: string; name: string }>> = {
  gemini: [
    { id: "gemini-embedding-001", name: "Gemini Embedding 001 (1536d, рекомендуется)" },
    { id: "gemini-embedding-2", name: "Gemini Embedding 2" },
    { id: "gemini-embedding-2-preview", name: "Gemini Embedding 2 Preview" },
  ],
  openai: [
    { id: "text-embedding-3-small", name: "text-embedding-3-small (1536d, рекомендуется)" },
    { id: "text-embedding-3-large", name: "text-embedding-3-large (3072d)" },
  ],
  deepseek: [
    { id: "text-embedding-3-small", name: "text-embedding-3-small" },
  ],
  openrouter: [
    { id: "openai/text-embedding-3-small", name: "OpenAI: text-embedding-3-small" },
  ],
  custom: [
    { id: "text-embedding-3-small", name: "text-embedding-3-small" },
  ],
};

export function AdminIntegrationsEditor() {
  const { data, isLoading, isError, error } = useAdminIntegrationsConfig();
  const updateMutation = useUpdateAdminIntegrationsConfig();
  const testLlmMutation = useTestAdminLlm();
  const fetchModelsMutation = useFetchLlmModels();
  const verifyKeysMutation = useVerifyLlmKeys();

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
        data.llmProviders.map((p) => {
          const isGemini = p.providerType === "gemini";
          const chatModel =
            isGemini && (p.chatModel === "gemini-2.0-flash" || p.chatModel === "gemini-2.5-flash")
              ? "gemini-3.5-flash-lite"
              : p.chatModel;
          const embeddingModel =
            isGemini && p.embeddingModel === "text-embedding-004"
              ? "gemini-embedding-001"
              : p.embeddingModel;

          return {
            id: p.id,
            name: p.name,
            providerType: p.providerType,
            baseUrl: p.baseUrl,
            keys: p.maskedKeys.length > 0 ? p.maskedKeys : [],
            chatModel,
            embeddingModel,
            isActive: p.isActive,
            isDefault: p.isDefault,
          };
        }),
      );
    } else {
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
          chatModel:
            data.llm.chatModel &&
            data.llm.chatModel !== "gemini-2.0-flash" &&
            data.llm.chatModel !== "gemini-2.5-flash"
              ? data.llm.chatModel
              : "gemini-3.5-flash-lite",
          embeddingModel:
            data.llm.embeddingModel && data.llm.embeddingModel !== "text-embedding-004"
              ? data.llm.embeddingModel
              : "gemini-embedding-001",
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
      const payload: { baseUrl?: string; apiKey?: string; providerId?: string } = {
        baseUrl: provider.baseUrl,
        providerId: provider.id,
      };

      if (firstKey && !firstKey.includes("•")) {
        payload.apiKey = firstKey;
      }

      const res = await testLlmMutation.mutateAsync(payload);
      if (res.success) {
        toast.success(
          `Связь с «${provider.name}» установлена${res.modelsCount ? ` (доступно моделей: ${res.modelsCount})` : ""}`,
        );
        // Если модели ещё не загружены, загрузим их автоматически
        if (!provider.availableModels || provider.availableModels.length === 0) {
          void handleFetchModels(provider.id);
        }
      } else {
        toast.error(`Ошибка проверки «${provider.name}»: ${res.message}`);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось проверить соединение с провайдером");
    } finally {
      setTestingProviderId(null);
    }
  };

  const handleFetchModels = async (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return;

    setProviders((prev) =>
      prev.map((p) => (p.id === providerId ? { ...p, isLoadingModels: true } : p)),
    );

    try {
      const firstKey = provider.keys[0];
      const payload: { baseUrl?: string; apiKey?: string; providerId?: string } = {
        baseUrl: provider.baseUrl,
        providerId: provider.id,
      };
      if (firstKey && !firstKey.includes("•")) {
        payload.apiKey = firstKey;
      }

      const res = await fetchModelsMutation.mutateAsync(payload);
      if (res.success && res.models.length > 0) {
        setProviders((prev) =>
          prev.map((p) =>
            p.id === providerId
              ? {
                  ...p,
                  availableModels: res.models,
                  isLoadingModels: false,
                }
              : p,
          ),
        );
        toast.success(`Загружено моделей: ${res.models.length} («${provider.name}»)`);
      } else {
        setProviders((prev) =>
          prev.map((p) => (p.id === providerId ? { ...p, isLoadingModels: false } : p)),
        );
        toast.error(`Не удалось загрузить модели: ${res.message || "список пуст"}`);
      }
    } catch (err: unknown) {
      setProviders((prev) =>
        prev.map((p) => (p.id === providerId ? { ...p, isLoadingModels: false } : p)),
      );
      toast.error(err instanceof Error ? err.message : "Ошибка при получении списка моделей");
    }
  };

  const handleVerifyAllKeys = async (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return;

    if (provider.keys.length === 0) {
      toast.error("В пуле нет ни одного ключа для проверки");
      return;
    }

    setProviders((prev) =>
      prev.map((p) => (p.id === providerId ? { ...p, isVerifyingKeys: true } : p)),
    );

    try {
      const payload = {
        baseUrl: provider.baseUrl,
        providerId: provider.id,
        keys: provider.keys,
      };

      const res = await verifyKeysMutation.mutateAsync(payload);

      const statusMap: Record<
        number,
        { status: "valid" | "invalid"; message: string; statusCode?: number }
      > = {};
      for (const r of res.results) {
        statusMap[r.index] = {
          status: r.status,
          message: r.message,
          statusCode: r.statusCode,
        };
      }

      setProviders((prev) =>
        prev.map((p) => {
          if (p.id !== providerId) return p;
          return {
            ...p,
            keyStatuses: statusMap,
            isVerifyingKeys: false,
            availableModels:
              res.models && res.models.length > 0 ? res.models : p.availableModels,
          };
        }),
      );

      if (res.summary.invalid === 0) {
        toast.success(
          `Все ключи активны! Проверено: ${res.summary.valid} из ${res.summary.total} шт.${
            res.models ? ` (доступно моделей: ${res.models.length})` : ""
          }`,
        );
      } else {
        toast.warning(
          `Проверка ключей: ${res.summary.valid} активны, ${res.summary.invalid} с ошибками`,
        );
      }
    } catch (err: unknown) {
      setProviders((prev) =>
        prev.map((p) => (p.id === providerId ? { ...p, isVerifyingKeys: false } : p)),
      );
      toast.error(err instanceof Error ? err.message : "Не удалось проверить доступность ключей");
    }
  };

  const handleVerifySingleKey = async (providerId: string, keyIndex: number) => {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return;
    const keyToTest = provider.keys[keyIndex];
    if (!keyToTest) return;

    setProviders((prev) =>
      prev.map((p) => (p.id === providerId ? { ...p, verifyingKeyIndex: keyIndex } : p)),
    );

    try {
      const payload = {
        baseUrl: provider.baseUrl,
        providerId: provider.id,
        keys: [keyToTest],
      };

      const res = await verifyKeysMutation.mutateAsync(payload);
      const singleRes = res.results[0];

      if (singleRes) {
        setProviders((prev) =>
          prev.map((p) => {
            if (p.id !== providerId) return p;
            const updatedStatuses = { ...(p.keyStatuses || {}) };
            updatedStatuses[keyIndex] = {
              status: singleRes.status,
              message: singleRes.message,
              statusCode: singleRes.statusCode,
            };
            return {
              ...p,
              keyStatuses: updatedStatuses,
              verifyingKeyIndex: null,
              availableModels:
                res.models && res.models.length > 0 ? res.models : p.availableModels,
            };
          }),
        );

        if (singleRes.status === "valid") {
          toast.success(`Ключ #${keyIndex + 1} активен и работает`);
        } else {
          toast.error(`Ключ #${keyIndex + 1}: ${singleRes.message}`);
        }
      }
    } catch (err: unknown) {
      setProviders((prev) =>
        prev.map((p) => (p.id === providerId ? { ...p, verifyingKeyIndex: null } : p)),
      );
      toast.error(err instanceof Error ? err.message : "Ошибка проверки ключа");
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

                {/* Chat Model с выпадающим списком доступных моделей */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-medium text-[#111111]">
                      Модель чата / диалогов *
                    </label>
                    <button
                      type="button"
                      onClick={() => handleFetchModels(provider.id)}
                      disabled={provider.isLoadingModels}
                      className="flex items-center gap-1 text-[11px] font-medium text-[#4a38f5] hover:text-[#3d2ee0] disabled:opacity-50 transition-colors"
                      title="Загрузить список реально доступных по ключам моделей через /models"
                    >
                      <RefreshCw
                        className={cn("h-3 w-3", provider.isLoadingModels && "animate-spin")}
                      />
                      {provider.isLoadingModels ? "Загрузка..." : "Обновить список"}
                    </button>
                  </div>

                  {(() => {
                    const loadedChatModels = (provider.availableModels || [])
                      .filter((m) => m.type === "chat")
                      .map((m) => ({
                        id: m.id,
                        name: m.name !== m.id ? `${m.name} (${m.id})` : m.id,
                      }));
                    const defaultChatPresets =
                      RECOMMENDED_CHAT_MODELS[provider.providerType] || [];
                    const baseChatList =
                      loadedChatModels.length > 0 ? loadedChatModels : defaultChatPresets;
                    const chatOptions = [...baseChatList];
                    if (
                      provider.chatModel &&
                      !chatOptions.some((opt) => opt.id === provider.chatModel)
                    ) {
                      chatOptions.unshift({
                        id: provider.chatModel,
                        name: `${provider.chatModel} (текущая)`,
                      });
                    }

                    if (provider.customChatModel) {
                      return (
                        <div className="flex items-center gap-1.5">
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
                            placeholder="gemini-3.5-flash-lite / gpt-4o-mini"
                            className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] font-mono focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setProviders(
                                providers.map((p) =>
                                  p.id === provider.id ? { ...p, customChatModel: false } : p,
                                ),
                              );
                            }}
                            className="h-8 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-[11px] font-medium text-[#666666] hover:bg-[#fafafa] whitespace-nowrap"
                            title="Вернуться к выбору из списка"
                          >
                            Список
                          </button>
                        </div>
                      );
                    }

                    return (
                      <div className="flex items-center gap-1.5">
                        <select
                          value={
                            chatOptions.some((opt) => opt.id === provider.chatModel)
                              ? provider.chatModel
                              : "__custom__"
                          }
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === "__custom__") {
                              setProviders(
                                providers.map((p) =>
                                  p.id === provider.id ? { ...p, customChatModel: true } : p,
                                ),
                              );
                            } else {
                              setProviders(
                                providers.map((p) =>
                                  p.id === provider.id ? { ...p, chatModel: val } : p,
                                ),
                              );
                            }
                          }}
                          className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-[13px] text-[#111111] font-mono focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 cursor-pointer"
                        >
                          {chatOptions.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.name}
                            </option>
                          ))}
                          <option value="__custom__">+ Указать модель вручную...</option>
                        </select>
                      </div>
                    );
                  })()}

                  <p className="text-[11px] text-[#888888]">
                    {provider.availableModels && provider.availableModels.length > 0
                      ? `Загружено из API провайдера (${
                          provider.availableModels.filter((m) => m.type === "chat").length
                        } моделей)`
                      : "Выберите из списка или нажмите «Обновить список»"}
                  </p>
                </div>

                {/* Embedding Model с выпадающим списком */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-medium text-[#111111]">
                      Модель векторных эмбеддингов *
                    </label>
                  </div>

                  {(() => {
                    const loadedEmbedModels = (provider.availableModels || [])
                      .filter((m) => m.type === "embedding")
                      .map((m) => ({
                        id: m.id,
                        name: m.name !== m.id ? `${m.name} (${m.id})` : m.id,
                      }));
                    const defaultEmbedPresets =
                      RECOMMENDED_EMBEDDING_MODELS[provider.providerType] || [];
                    const baseEmbedList =
                      loadedEmbedModels.length > 0 ? loadedEmbedModels : defaultEmbedPresets;
                    const embedOptions = [...baseEmbedList];
                    if (
                      provider.embeddingModel &&
                      !embedOptions.some((opt) => opt.id === provider.embeddingModel)
                    ) {
                      embedOptions.unshift({
                        id: provider.embeddingModel,
                        name: `${provider.embeddingModel} (текущая)`,
                      });
                    }

                    if (provider.customEmbeddingModel) {
                      return (
                        <div className="flex items-center gap-1.5">
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
                            placeholder="gemini-embedding-001 / text-embedding-3-small"
                            className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] font-mono focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setProviders(
                                providers.map((p) =>
                                  p.id === provider.id
                                    ? { ...p, customEmbeddingModel: false }
                                    : p,
                                ),
                              );
                            }}
                            className="h-8 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-[11px] font-medium text-[#666666] hover:bg-[#fafafa] whitespace-nowrap"
                            title="Вернуться к выбору из списка"
                          >
                            Список
                          </button>
                        </div>
                      );
                    }

                    return (
                      <div className="flex items-center gap-1.5">
                        <select
                          value={
                            embedOptions.some((opt) => opt.id === provider.embeddingModel)
                              ? provider.embeddingModel
                              : "__custom__"
                          }
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === "__custom__") {
                              setProviders(
                                providers.map((p) =>
                                  p.id === provider.id
                                    ? { ...p, customEmbeddingModel: true }
                                    : p,
                                ),
                              );
                            } else {
                              setProviders(
                                providers.map((p) =>
                                  p.id === provider.id ? { ...p, embeddingModel: val } : p,
                                ),
                              );
                            }
                          }}
                          className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-[13px] text-[#111111] font-mono focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 cursor-pointer"
                        >
                          {embedOptions.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.name}
                            </option>
                          ))}
                          <option value="__custom__">+ Указать модель вручную...</option>
                        </select>
                      </div>
                    );
                  })()}

                  <p className="text-[11px] text-[#888888]">
                    Используется базой знаний RAG (векторизация)
                  </p>
                </div>
              </div>

              {/* Блок пула API-ключей */}
              <div className="mt-5 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Key className="h-4 w-4 text-[#4a38f5]" />
                    <span className="text-xs font-semibold text-[#111111]">
                      Пул API-ключей ({provider.keys.length} шт.)
                    </span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                      Round-Robin ротация + failover 429
                    </span>

                    {/* Сводный бейдж проверки ключей */}
                    {provider.keyStatuses && Object.keys(provider.keyStatuses).length > 0 && (
                      (() => {
                        const statuses = Object.values(provider.keyStatuses);
                        const validCount = statuses.filter((s) => s.status === "valid").length;
                        const invalidCount = statuses.length - validCount;

                        if (invalidCount === 0) {
                          return (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                              Все проверенные работают ({validCount}/{statuses.length})
                            </span>
                          );
                        }

                        return (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700">
                            <AlertCircle className="h-3 w-3 text-rose-600" />
                            {validCount} активны, {invalidCount} с ошибкой
                          </span>
                        );
                      })()
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Кнопка проверки доступности всех ключей пула */}
                    <button
                      type="button"
                      onClick={() => handleVerifyAllKeys(provider.id)}
                      disabled={provider.isVerifyingKeys || provider.keys.length === 0}
                      className="flex items-center gap-1.5 rounded-[6px] border border-[#4a38f5] bg-[#4a38f5] px-2.5 py-1 text-xs font-medium text-white shadow-2xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50"
                      title="Проверить работоспособность всех ключей в пуле"
                    >
                      {provider.isVerifyingKeys ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      {provider.isVerifyingKeys ? "Проверка ключей..." : "Проверить ключи"}
                    </button>

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
                      className="flex items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-medium text-[#111111] hover:bg-[#fafafa] shadow-2xs transition-colors"
                    >
                      <FileText className="h-3.5 w-3.5 text-[#666666]" />
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

                {/* Список добавленных ключей пула с проверкой статуса */}
                <div className="mt-3 space-y-2">
                  {provider.keys.length === 0 ? (
                    <div className="rounded-[6px] border border-dashed border-[#e5e5e5] bg-white py-4 text-center text-xs text-[#888888]">
                      В пуле нет ни одного ключа. Нажмите кнопку «Вставить пачкой (списком)» и
                      добавьте 20 ключей.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                      {provider.keys.map((k, kIndex) => {
                        const kStatus = provider.keyStatuses?.[kIndex];
                        const isSingleVerifying = provider.verifyingKeyIndex === kIndex;

                        return (
                          <div
                            key={`${provider.id}-k-${kIndex}`}
                            className={cn(
                              "flex flex-col justify-between rounded-[6px] border bg-white p-2 shadow-2xs transition-colors",
                              kStatus?.status === "valid" && "border-emerald-200 bg-emerald-50/15",
                              kStatus?.status === "invalid" && "border-rose-200 bg-rose-50/25",
                              !kStatus && "border-[#e5e5e5]",
                            )}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <div className="flex items-center gap-1.5 overflow-hidden">
                                <span className="rounded bg-neutral-100 px-1 py-0.5 text-[10px] font-mono font-medium text-[#666666]">
                                  #{kIndex + 1}
                                </span>
                                <span
                                  className="truncate font-mono text-xs text-[#111111]"
                                  title={k}
                                >
                                  {k}
                                </span>
                              </div>

                              <div className="flex items-center gap-0.5 flex-shrink-0">
                                {/* Кнопка быстрой индивидуальной проверки ключа */}
                                <button
                                  type="button"
                                  onClick={() => handleVerifySingleKey(provider.id, kIndex)}
                                  disabled={isSingleVerifying || provider.isVerifyingKeys}
                                  className="p-1 text-[#888888] hover:text-[#4a38f5] transition-colors"
                                  title="Проверить этот ключ"
                                >
                                  {isSingleVerifying ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
                                  ) : (
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveKey(provider.id, kIndex)}
                                  className="p-1 text-[#888888] hover:text-rose-600 transition-colors"
                                  title="Удалить ключ"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* Нижняя строчка: статус ключа */}
                            <div className="mt-1 flex items-center justify-between gap-1 text-[10px]">
                              {kStatus ? (
                                kStatus.status === "valid" ? (
                                  <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                    {kStatus.message || "Работает"}
                                  </span>
                                ) : (
                                  <span
                                    className="inline-flex items-center gap-1 text-rose-600 font-medium truncate"
                                    title={kStatus.message}
                                  >
                                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500 flex-shrink-0" />
                                    <span className="truncate">{kStatus.message}</span>
                                  </span>
                                )
                              ) : isSingleVerifying ? (
                                <span className="inline-flex items-center gap-1 text-[#666666]">
                                  <Loader2 className="h-3 w-3 animate-spin text-[#4a38f5]" />
                                  Проверка связи...
                                </span>
                              ) : (
                                <span className="text-[#888888]">Не проверен</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
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