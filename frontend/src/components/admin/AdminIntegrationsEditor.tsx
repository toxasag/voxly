"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  CreditCard,
  Eye,
  EyeOff,
  HelpCircle,
  Key,
  Layers,
  Link as LinkIcon,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  type AdminIntegrationsConfigDTO,
  useAdminIntegrationsConfig,
  useTestAdminLlm,
  useUpdateAdminIntegrationsConfig,
} from "@/lib/api/use-admin";
import { cn } from "@/lib/utils";

export function AdminIntegrationsEditor() {
  const { data, isLoading, isError, error, refetch, isFetching } = useAdminIntegrationsConfig();
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

  // LLM state
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [showLlmKey, setShowLlmKey] = useState(false);
  const [llmEmbeddingModel, setLlmEmbeddingModel] = useState("text-embedding-3-small");
  const [llmChatModel, setLlmChatModel] = useState("openai/gpt-4o-mini");

  // Sync state from query data
  useEffect(() => {
    if (!data) return;

    setMerchantLogin(data.robokassa.merchantLogin || "");
    setPassword1Value(data.robokassa.hasPassword1 ? "••••••••••••" : "");
    setPassword2Value(data.robokassa.hasPassword2 ? "••••••••••••" : "");
    setIsTestMode(data.robokassa.isTest);
    setHashAlgo((data.robokassa.hashAlgo === "MD5" ? "MD5" : "SHA256"));
    setTax(data.robokassa.tax || "none");

    setLlmBaseUrl(data.llm.baseUrl || "");
    setLlmApiKey(data.llm.hasApiKey ? "••••••••••••••••••••" : "");
    setLlmEmbeddingModel(data.llm.embeddingModel || "text-embedding-3-small");
    setLlmChatModel(data.llm.chatModel || "openai/gpt-4o-mini");
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

  const handleSaveLlm = async () => {
    try {
      const payload: {
        baseUrl: string;
        embeddingModel: string;
        chatModel: string;
        apiKey?: string;
      } = {
        baseUrl: llmBaseUrl,
        embeddingModel: llmEmbeddingModel,
        chatModel: llmChatModel,
      };

      if (llmApiKey && !llmApiKey.includes("•")) {
        payload.apiKey = llmApiKey;
      }

      await updateMutation.mutateAsync({ llm: payload });
      toast.success("Настройки ИИ-провайдера успешно сохранены");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить настройки ИИ-провайдера");
    }
  };

  const handleTestLlm = async () => {
    try {
      const payload: { baseUrl?: string; apiKey?: string } = {};
      if (llmBaseUrl) payload.baseUrl = llmBaseUrl;
      if (llmApiKey && !llmApiKey.includes("•")) payload.apiKey = llmApiKey;

      const res = await testLlmMutation.mutateAsync(payload);
      if (res.success) {
        toast.success(`Успешно: ${res.message}${res.modelsCount ? ` (доступно моделей: ${res.modelsCount})` : ""}`);
      } else {
        toast.error(`Ошибка проверки: ${res.message}`);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось выполнить проверку соединения");
    }
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
  const isLlmConfigured = data?.llm.isConfigured ?? false;

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

      {/* 2. Блок ИИ-провайдера (LLM) */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#f0f0f0] pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-[#4a38f5]">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-[#111111]">ИИ-провайдер (LLM & Embeddings)</h2>
                {isLlmConfigured ? (
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
                Подключение моделей для AI-агентов, базы знаний (RAG) и векторного поиска
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTestLlm}
              disabled={testLlmMutation.isPending}
              className="flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] font-medium text-[#111111] shadow-2xs transition-colors hover:border-[#cccccc] hover:bg-[#fafafa] disabled:opacity-50"
            >
              {testLlmMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin text-[#4a38f5]" />
              ) : (
                <Server className="h-4 w-4 text-[#666666]" />
              )}
              Проверить связь
            </button>

            <button
              type="button"
              onClick={handleSaveLlm}
              disabled={updateMutation.isPending}
              className="flex items-center gap-2 rounded-[8px] bg-[#4a38f5] px-4 py-2 text-[13px] font-medium text-white shadow-2xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50"
            >
              {updateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Сохранить ИИ-провайдера
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* Base URL */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#111111]">
              Базовый адрес API (Base URL) *
            </label>
            <input
              type="text"
              value={llmBaseUrl}
              onChange={(e) => setLlmBaseUrl(e.target.value)}
              placeholder="https://openrouter.ai/api/v1 или https://api.openai.com/v1"
              className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono"
            />
            <p className="text-[11px] text-[#888888]">
              Совместимый с OpenAI endpoint провайдера (OpenRouter, DeepSeek, OpenAI, Anthropic proxy)
            </p>
          </div>

          {/* API Key */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#111111]">
              Секретный API-ключ *
            </label>
            <div className="relative">
              <input
                type={showLlmKey ? "text" : "password"}
                value={llmApiKey}
                onChange={(e) => setLlmApiKey(e.target.value)}
                placeholder="sk-or-v1-..."
                className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 pr-9 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowLlmKey(!showLlmKey)}
                className="absolute right-2.5 top-2 text-[#888888] hover:text-[#111111]"
              >
                {showLlmKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[11px] text-[#888888]">
              Ключ для авторизации запросов в заголовке Authorization: Bearer
            </p>
          </div>

          {/* Embedding Model */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#111111]">
              Модель векторных эмбеддингов (1536d) *
            </label>
            <input
              type="text"
              value={llmEmbeddingModel}
              onChange={(e) => setLlmEmbeddingModel(e.target.value)}
              placeholder="text-embedding-3-small"
              className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono"
            />
            <p className="text-[11px] text-[#888888]">
              Используется для базы знаний RAG (должна выдавать векторы размерности 1536)
            </p>
          </div>

          {/* Default Chat Model */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#111111]">
              Дефолтная модель диалогов *
            </label>
            <input
              type="text"
              value={llmChatModel}
              onChange={(e) => setLlmChatModel(e.target.value)}
              placeholder="openai/gpt-4o-mini"
              className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono"
            />
            <p className="text-[11px] text-[#888888]">
              Используется по умолчанию для ответов AI-агентов в чатах
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
