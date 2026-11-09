import { getEnv } from "../../config/env.js";
import { query, queryOne, runWithPlatformScope } from "../../db/client.js";

export type LlmProviderType = "gemini" | "openai" | "openrouter" | "deepseek" | "custom";

export interface LlmProviderStoredItem {
  id: string;
  name: string;
  providerType: LlmProviderType;
  baseUrl: string;
  apiKeys: string[];
  chatModel: string;
  embeddingModel: string;
  isActive: boolean;
  isDefault: boolean;
}

export interface LlmProviderDTO {
  id: string;
  name: string;
  providerType: LlmProviderType;
  baseUrl: string;
  apiKeysCount: number;
  maskedKeys: string[];
  chatModel: string;
  embeddingModel: string;
  isActive: boolean;
  isDefault: boolean;
}

export interface LlmProviderPayload {
  id: string;
  name: string;
  providerType: LlmProviderType;
  baseUrl: string;
  apiKeys?: string[];
  chatModel: string;
  embeddingModel: string;
  isActive: boolean;
  isDefault: boolean;
}

export interface RotatedLlmConfig {
  baseUrl: string;
  apiKey: string;
  allKeys: string[];
  chatModel: string;
  embeddingModel: string;
  providerId?: string;
  providerName?: string;
}

export interface IntegrationsConfigDTO {
  robokassa: {
    merchantLogin: string;
    isTest: boolean;
    hashAlgo: string;
    tax: string;
    hasPassword1: boolean;
    hasPassword2: boolean;
    isConfigured: boolean;
  };
  llm: {
    baseUrl: string;
    hasApiKey: boolean;
    embeddingModel: string;
    chatModel: string;
    isConfigured: boolean;
  };
  llmProviders: LlmProviderDTO[];
  updatedAt: string;
}

export interface AvailableModelItem {
  id: string;
  name: string;
  type: "chat" | "embedding";
}

export interface KeyVerificationResult {
  index: number;
  maskedKey: string;
  status: "valid" | "invalid" | "pending_activation";
  statusCode?: number;
  message: string;
  modelsCount?: number;
  isTemporary?: boolean;
}

export interface VerifyProviderKeysResult {
  success: boolean;
  summary: {
    total: number;
    valid: number;
    invalid: number;
    pendingActivation?: number;
  };
  results: KeyVerificationResult[];
  models?: AvailableModelItem[];
  message?: string;
}

export function isGoogleCloudPropagationDelay(statusCode?: number, errorText?: string): boolean {
  if (statusCode !== 403 && statusCode !== 400) return false;
  const lower = (errorText || "").toLowerCase();
  return (
    lower.includes("has not been used in project") ||
    lower.includes("is disabled") ||
    lower.includes("propagate to our systems") ||
    lower.includes("service_disabled") ||
    lower.includes("accessnotconfigured") ||
    (lower.includes("gemini api") && (lower.includes("enable") || lower.includes("propagation"))) ||
    lower.includes("wait a few minutes for the action to propagate")
  );
}

export interface EffectiveIntegrations {
  robokassa: {
    merchantLogin: string | null;
    password1: string | null;
    password2: string | null;
    isTest: boolean;
    hashAlgo: "SHA256" | "MD5";
    tax: string;
    isConfigured: boolean;
  };
  llm: {
    baseUrl: string | null;
    apiKey: string | null;
    embeddingModel: string;
    chatModel: string;
    isConfigured: boolean;
  };
  llmProviders: LlmProviderStoredItem[];
}

export interface UpdateIntegrationsPayload {
  robokassa?: {
    merchantLogin?: string;
    password1?: string;
    password2?: string;
    isTest?: boolean;
    hashAlgo?: "SHA256" | "MD5";
    tax?: string;
  };
  llm?: {
    baseUrl?: string;
    apiKey?: string;
    embeddingModel?: string;
    chatModel?: string;
  };
  llmProviders?: LlmProviderPayload[];
}

interface PlatformIntegrationsRow {
  id: string;
  robokassa_login: string | null;
  robokassa_password_1: string | null;
  robokassa_password_2: string | null;
  robokassa_is_test: boolean;
  robokassa_hash_algo: string;
  robokassa_tax: string;
  llm_api_base_url: string | null;
  llm_api_key: string | null;
  llm_embedding_model: string | null;
  llm_chat_model: string | null;
  llm_providers: LlmProviderStoredItem[] | null;
  updated_at: Date | string;
}

function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

export class PlatformConfigService {
  private cachedEffective: EffectiveIntegrations | null = null;
  private cacheExpiresAt = 0;
  private roundRobinIndex = 0;
  private invalidKeysMap = new Map<string, number>();
  private pendingActivationKeysMap = new Map<string, number>();

  markKeyInvalid(key: string, ttlMs = 5 * 60 * 1000): void {
    const trimmed = key?.trim();
    if (trimmed) {
      this.invalidKeysMap.set(trimmed, Date.now() + ttlMs);
      this.pendingActivationKeysMap.delete(trimmed);
    }
  }

  markKeyPendingActivation(key: string, ttlMs = 2 * 60 * 1000): void {
    const trimmed = key?.trim();
    if (trimmed) {
      this.pendingActivationKeysMap.set(trimmed, Date.now() + ttlMs);
      this.invalidKeysMap.delete(trimmed);
    }
  }

  isKeyPendingActivation(key: string): boolean {
    const trimmed = key?.trim();
    if (!trimmed) return false;
    const expiresAt = this.pendingActivationKeysMap.get(trimmed);
    if (!expiresAt) return false;
    if (Date.now() > expiresAt) {
      this.pendingActivationKeysMap.delete(trimmed);
      return false;
    }
    return true;
  }

  markKeyValid(key: string): void {
    const trimmed = key?.trim();
    if (trimmed) {
      this.invalidKeysMap.delete(trimmed);
      this.pendingActivationKeysMap.delete(trimmed);
    }
  }

  isKeyInvalid(key: string): boolean {
    const trimmed = key?.trim();
    if (!trimmed) return true;
    const expiresAt = this.invalidKeysMap.get(trimmed);
    if (!expiresAt) return false;
    if (Date.now() > expiresAt) {
      this.invalidKeysMap.delete(trimmed);
      return false;
    }
    return true;
  }

  isLlmConfiguredSync(): boolean {
    if (this.cachedEffective) {
      if (
        this.cachedEffective.llmProviders.some(
          (p) => p.isActive && p.apiKeys.length > 0 && Boolean(p.baseUrl),
        )
      ) {
        return true;
      }
      return this.cachedEffective.llm.isConfigured;
    }
    const env = getEnv();
    return Boolean(env.LLM_API_BASE_URL && env.LLM_API_KEY);
  }

  isRobokassaConfiguredSync(): boolean {
    if (this.cachedEffective) {
      return this.cachedEffective.robokassa.isConfigured;
    }
    const env = getEnv();
    return Boolean(
      env.ROBOKASSA_MERCHANT_LOGIN && env.ROBOKASSA_PASSWORD_1 && env.ROBOKASSA_PASSWORD_2,
    );
  }

  /**
   * Получение текущих настроек для отображения в панели администратора.
   * Секреты (пароли и API-ключи) маскируются.
   */
  async getIntegrationsConfig(): Promise<IntegrationsConfigDTO> {
    const effective = await this.getEffectiveIntegrations();
    const row = await runWithPlatformScope(async () => {
      return queryOne<PlatformIntegrationsRow>(
        `SELECT updated_at FROM platform_integrations_config WHERE id = 'default'`,
      );
    });

    let providersDTO: LlmProviderDTO[] = effective.llmProviders.map((p) => ({
      id: p.id,
      name: p.name,
      providerType: p.providerType,
      baseUrl: p.baseUrl,
      apiKeysCount: p.apiKeys.length,
      maskedKeys: p.apiKeys.map(maskApiKey),
      chatModel: p.chatModel,
      embeddingModel: p.embeddingModel,
      isActive: p.isActive,
      isDefault: p.isDefault,
    }));

    // Если список провайдеров в БД ещё пуст, но заданы базовые URL/ключ — создаём начальный элемент
    if (providersDTO.length === 0 && (effective.llm.baseUrl || effective.llm.apiKey)) {
      providersDTO = [
        {
          id: "prov-default",
          name: "Основной провайдер",
          providerType: "custom",
          baseUrl: effective.llm.baseUrl ?? "",
          apiKeysCount: effective.llm.apiKey ? 1 : 0,
          maskedKeys: effective.llm.apiKey ? [maskApiKey(effective.llm.apiKey)] : [],
          chatModel: effective.llm.chatModel,
          embeddingModel: effective.llm.embeddingModel,
          isActive: true,
          isDefault: true,
        },
      ];
    }

    return {
      robokassa: {
        merchantLogin: effective.robokassa.merchantLogin ?? "",
        isTest: effective.robokassa.isTest,
        hashAlgo: effective.robokassa.hashAlgo,
        tax: effective.robokassa.tax,
        hasPassword1: !!effective.robokassa.password1,
        hasPassword2: !!effective.robokassa.password2,
        isConfigured: effective.robokassa.isConfigured,
      },
      llm: {
        baseUrl: effective.llm.baseUrl ?? "",
        hasApiKey: !!effective.llm.apiKey,
        embeddingModel: effective.llm.embeddingModel,
        chatModel: effective.llm.chatModel,
        isConfigured: effective.llm.isConfigured,
      },
      llmProviders: providersDTO,
      updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    };
  }

  /**
   * Получение актуальных рабочих параметров интеграций для бэкенд-сервисов
   * (с приоритетом БД над переменными окружения).
   */
  async getEffectiveIntegrations(): Promise<EffectiveIntegrations> {
    const now = Date.now();
    if (this.cachedEffective && now < this.cacheExpiresAt) {
      return this.cachedEffective;
    }

    const env = getEnv();

    const dbRow = await runWithPlatformScope(async () => {
      return queryOne<PlatformIntegrationsRow>(
        `SELECT * FROM platform_integrations_config WHERE id = 'default'`,
      );
    });

    // Robokassa: сначала смотрим в БД, если не заполнено — fallback на env
    const rLogin = dbRow?.robokassa_login?.trim() || env.ROBOKASSA_MERCHANT_LOGIN || null;
    const rPass1 = dbRow?.robokassa_password_1?.trim() || env.ROBOKASSA_PASSWORD_1 || null;
    const rPass2 = dbRow?.robokassa_password_2?.trim() || env.ROBOKASSA_PASSWORD_2 || null;
    const rIsTest = dbRow ? dbRow.robokassa_is_test : env.ROBOKASSA_IS_TEST;
    const rHashAlgo = (
      dbRow?.robokassa_hash_algo === "MD5" || env.ROBOKASSA_HASH_ALGO === "MD5" ? "MD5" : "SHA256"
    ) as "SHA256" | "MD5";
    const rTax = dbRow?.robokassa_tax || env.ROBOKASSA_TAX || "none";

    const isRoboConfigured = !!(rLogin && rPass1 && rPass2);

    // LLM: сначала БД, затем env
    const llmUrl = dbRow?.llm_api_base_url?.trim() || env.LLM_API_BASE_URL || null;
    const llmKey = dbRow?.llm_api_key?.trim() || env.LLM_API_KEY || null;
    const llmEmbedModel =
      dbRow?.llm_embedding_model?.trim() || env.LLM_EMBEDDING_MODEL || "text-embedding-3-small";
    const llmChatModel = dbRow?.llm_chat_model?.trim() || "openai/gpt-4o-mini";

    let storedProviders: LlmProviderStoredItem[] = [];
    if (Array.isArray(dbRow?.llm_providers) && dbRow.llm_providers.length > 0) {
      storedProviders = dbRow.llm_providers.filter(
        (p): p is LlmProviderStoredItem =>
          typeof p === "object" &&
          p !== null &&
          typeof p.id === "string" &&
          typeof p.baseUrl === "string",
      );
    }

    // Если в БД пул ещё не заполнен, но задан одиночный ключ — синтезируем дефолтный элемент пула
    if (storedProviders.length === 0 && (llmUrl || llmKey)) {
      storedProviders = [
        {
          id: "prov-default",
          name: "Основной провайдер",
          providerType: "custom",
          baseUrl: llmUrl ?? "",
          apiKeys: llmKey ? [llmKey] : [],
          chatModel: llmChatModel,
          embeddingModel: llmEmbedModel,
          isActive: true,
          isDefault: true,
        },
      ];
    }

    const isLlmConfigured =
      storedProviders.some((p) => p.isActive && p.apiKeys.length > 0 && Boolean(p.baseUrl)) ||
      Boolean(llmUrl && llmKey);

    const result: EffectiveIntegrations = {
      robokassa: {
        merchantLogin: rLogin,
        password1: rPass1,
        password2: rPass2,
        isTest: rIsTest,
        hashAlgo: rHashAlgo,
        tax: rTax,
        isConfigured: isRoboConfigured,
      },
      llm: {
        baseUrl: llmUrl,
        apiKey: llmKey,
        embeddingModel: llmEmbedModel,
        chatModel: llmChatModel,
        isConfigured: isLlmConfigured,
      },
      llmProviders: storedProviders,
    };

    this.cachedEffective = result;
    this.cacheExpiresAt = now + 15_000;

    return result;
  }

  /**
   * Получение конфигурации активного LLM с циклической ротацией ключей (Round-Robin)
   * и списком всех ключей пула для прозрачного failover при HTTP 429.
   */
  async getRotatedLlmConfig(): Promise<RotatedLlmConfig | null> {
    const effective = await this.getEffectiveIntegrations();

    // 1. Ищем активный провайдер по умолчанию с заполненными ключами
    let target = effective.llmProviders.find(
      (p) => p.isActive && p.isDefault && p.apiKeys.length > 0 && Boolean(p.baseUrl),
    );

    // 2. Если по умолчанию не найден, берём первый активный с ключами
    if (!target) {
      target = effective.llmProviders.find(
        (p) => p.isActive && p.apiKeys.length > 0 && Boolean(p.baseUrl),
      );
    }

    if (target && target.apiKeys.length > 0) {
      const allTargetKeys = target.apiKeys;
      const validKeys = allTargetKeys.filter((k) => !this.isKeyInvalid(k));
      // Если есть заведомо проверенные/не отклонённые ключи, ротируем их в первую очередь
      const keys = validKeys.length > 0 ? validKeys : allTargetKeys;

      const pickedIndex = this.roundRobinIndex % keys.length;
      this.roundRobinIndex = (this.roundRobinIndex + 1) % keys.length;
      const selectedKey = keys[pickedIndex] ?? keys[0] ?? "";

      // Составляем упорядоченный список ключей для failover, помещая оставшиеся ключи в конец
      const otherKeys = allTargetKeys.filter((k) => k !== selectedKey);
      const allKeys = [selectedKey, ...otherKeys];

      return {
        baseUrl: target.baseUrl,
        apiKey: selectedKey,
        allKeys,
        chatModel: target.chatModel,
        embeddingModel: target.embeddingModel,
        providerId: target.id,
        providerName: target.name,
      };
    }

    // 3. Fallback на одиночный ключ legacy
    if (effective.llm.baseUrl && effective.llm.apiKey) {
      return {
        baseUrl: effective.llm.baseUrl,
        apiKey: effective.llm.apiKey,
        allKeys: [effective.llm.apiKey],
        chatModel: effective.llm.chatModel,
        embeddingModel: effective.llm.embeddingModel,
        providerName: "Legacy Default",
      };
    }

    return null;
  }

  /**
   * Обновление настроек интеграций из интерфейса администратора платформы.
   */
  async updateIntegrationsConfig(payload: UpdateIntegrationsPayload): Promise<IntegrationsConfigDTO> {
    this.cachedEffective = null;
    this.cacheExpiresAt = 0;

    await runWithPlatformScope(async () => {
      const current = await queryOne<PlatformIntegrationsRow>(
        `SELECT * FROM platform_integrations_config WHERE id = 'default'`,
      );

      // Robokassa values
      let nextLogin = current?.robokassa_login ?? null;
      let nextPass1 = current?.robokassa_password_1 ?? null;
      let nextPass2 = current?.robokassa_password_2 ?? null;
      let nextIsTest = current?.robokassa_is_test ?? true;
      let nextHashAlgo = current?.robokassa_hash_algo ?? "SHA256";
      let nextTax = current?.robokassa_tax ?? "none";

      if (payload.robokassa) {
        if (payload.robokassa.merchantLogin !== undefined) {
          nextLogin = payload.robokassa.merchantLogin.trim() || null;
        }
        if (
          payload.robokassa.password1 !== undefined &&
          payload.robokassa.password1.trim() &&
          !payload.robokassa.password1.includes("•")
        ) {
          nextPass1 = payload.robokassa.password1.trim();
        }
        if (
          payload.robokassa.password2 !== undefined &&
          payload.robokassa.password2.trim() &&
          !payload.robokassa.password2.includes("•")
        ) {
          nextPass2 = payload.robokassa.password2.trim();
        }
        if (payload.robokassa.isTest !== undefined) {
          nextIsTest = payload.robokassa.isTest;
        }
        if (payload.robokassa.hashAlgo !== undefined) {
          nextHashAlgo = payload.robokassa.hashAlgo;
        }
        if (payload.robokassa.tax !== undefined) {
          nextTax = payload.robokassa.tax;
        }
      }

      // Existing stored providers for unmasking
      const existingProviders = Array.isArray(current?.llm_providers)
        ? (current.llm_providers as LlmProviderStoredItem[])
        : [];

      // LLM values
      let nextLlmUrl = current?.llm_api_base_url ?? null;
      let nextLlmKey = current?.llm_api_key ?? null;
      let nextLlmEmbedModel = current?.llm_embedding_model ?? "text-embedding-3-small";
      let nextLlmChatModel = current?.llm_chat_model ?? "openai/gpt-4o-mini";
      let nextProviders: LlmProviderStoredItem[] = existingProviders;

      if (payload.llmProviders !== undefined) {
        nextProviders = payload.llmProviders.map((p) => {
          const prevMatch = existingProviders.find((ep) => ep.id === p.id);
          const rawKeys = p.apiKeys ?? [];

          // Восстанавливаем оригинальные ключи для тех строк, которые пришли замаскированными
          const unmaskedKeys: string[] = [];
          for (let i = 0; i < rawKeys.length; i++) {
            const raw = rawKeys[i];
            if (!raw) continue;
            const k = raw.trim();
            if (!k) continue;

            if (k.includes("•")) {
              // Ищем исходный ключ из базы
              let restored = prevMatch?.apiKeys[i];
              if (!restored && prevMatch?.apiKeys) {
                // Если индекс сместился, ищем по соответствию маске
                restored = prevMatch.apiKeys.find((orig) => maskApiKey(orig) === k);
              }
              if (restored) {
                unmaskedKeys.push(restored.trim());
              }
            } else {
              unmaskedKeys.push(k);
            }
          }

          return {
            id: p.id,
            name: p.name.trim() || "AI Provider",
            providerType: p.providerType,
            baseUrl: p.baseUrl.trim(),
            apiKeys: unmaskedKeys,
            chatModel: p.chatModel.trim() || "openai/gpt-4o-mini",
            embeddingModel: p.embeddingModel.trim() || "text-embedding-3-small",
            isActive: p.isActive,
            isDefault: p.isDefault,
          };
        });

        // Гарантируем, что ровно один активный провайдер отмечен как дефолтный
        const defaultIndex = nextProviders.findIndex((p) => p.isDefault && p.isActive);
        if (defaultIndex === -1 && nextProviders.length > 0) {
          const firstActive = nextProviders.findIndex((p) => p.isActive);
          if (firstActive !== -1 && nextProviders[firstActive]) {
            nextProviders[firstActive]!.isDefault = true;
          } else if (nextProviders[0]) {
            nextProviders[0]!.isDefault = true;
          }
        }

        // Синхронизируем старые скалярные колонки с дефолтным провайдером для 100% обратной совместимости
        const defProv = nextProviders.find((p) => p.isDefault) || nextProviders[0];
        if (defProv) {
          nextLlmUrl = defProv.baseUrl || null;
          nextLlmKey = defProv.apiKeys[0] || null;
          nextLlmEmbedModel = defProv.embeddingModel || "text-embedding-3-small";
          nextLlmChatModel = defProv.chatModel || "openai/gpt-4o-mini";
        }
      }

      // Legacy direct `llm` payload support
      if (payload.llm) {
        if (payload.llm.baseUrl !== undefined) {
          nextLlmUrl = payload.llm.baseUrl.trim() || null;
        }
        if (
          payload.llm.apiKey !== undefined &&
          payload.llm.apiKey.trim() &&
          !payload.llm.apiKey.includes("•")
        ) {
          nextLlmKey = payload.llm.apiKey.trim();
        }
        if (payload.llm.embeddingModel !== undefined) {
          nextLlmEmbedModel = payload.llm.embeddingModel.trim() || "text-embedding-3-small";
        }
        if (payload.llm.chatModel !== undefined) {
          nextLlmChatModel = payload.llm.chatModel.trim() || "openai/gpt-4o-mini";
        }
      }

      await queryOne(
        `INSERT INTO platform_integrations_config (
          id, robokassa_login, robokassa_password_1, robokassa_password_2,
          robokassa_is_test, robokassa_hash_algo, robokassa_tax,
          llm_api_base_url, llm_api_key, llm_embedding_model, llm_chat_model,
          llm_providers, updated_at
        ) VALUES (
          'default', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now()
        ) ON CONFLICT (id) DO UPDATE SET
          robokassa_login = EXCLUDED.robokassa_login,
          robokassa_password_1 = EXCLUDED.robokassa_password_1,
          robokassa_password_2 = EXCLUDED.robokassa_password_2,
          robokassa_is_test = EXCLUDED.robokassa_is_test,
          robokassa_hash_algo = EXCLUDED.robokassa_hash_algo,
          robokassa_tax = EXCLUDED.robokassa_tax,
          llm_api_base_url = EXCLUDED.llm_api_base_url,
          llm_api_key = EXCLUDED.llm_api_key,
          llm_embedding_model = EXCLUDED.llm_embedding_model,
          llm_chat_model = EXCLUDED.llm_chat_model,
          llm_providers = EXCLUDED.llm_providers,
          updated_at = now()`,
        [
          nextLogin,
          nextPass1,
          nextPass2,
          nextIsTest,
          nextHashAlgo,
          nextTax,
          nextLlmUrl,
          nextLlmKey,
          nextLlmEmbedModel,
          nextLlmChatModel,
          JSON.stringify(nextProviders),
        ],
      );
    });

    return this.getIntegrationsConfig();
  }

  /**
   * Тестовая проверка подключения к LLM-провайдеру.
   */
  async testLlmConnection(override?: {
    baseUrl?: string;
    apiKey?: string;
    providerId?: string;
  }): Promise<{ success: boolean; message: string; modelsCount?: number }> {
    const effective = await this.getEffectiveIntegrations();
    const provider = override?.providerId
      ? effective.llmProviders.find((p) => p.id === override.providerId)
      : effective.llmProviders.find((p) => p.isDefault) || effective.llmProviders[0];

    const url = (override?.baseUrl?.trim() || provider?.baseUrl || effective.llm.baseUrl)?.replace(/\/+$/, "");

    let key = override?.apiKey?.trim();
    if (!key || key.includes("•")) {
      key = provider?.apiKeys[0] || effective.llm.apiKey || undefined;
    }

    if (!url || !key) {
      return { success: false, message: "Не указан базовый URL или API-ключ провайдера" };
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { success: false, message: "Поддерживаются только протоколы http:// и https://" };
      }
      if (parsed.hostname === "169.254.169.254" || parsed.hostname === "metadata.google.internal") {
        return { success: false, message: "Запрос к адресам метаданных запрещен" };
      }
    } catch {
      return { success: false, message: "Указан некорректный URL провайдера" };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(`${url}/models`, {
        headers: {
          Authorization: `Bearer ${key}`,
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          success: false,
          message: `Провайдер вернул HTTP ${res.status}: ${text.slice(0, 150) || res.statusText}`,
        };
      }

      const data = (await res.json().catch(() => ({}))) as { data?: unknown[] };
      const count = Array.isArray(data?.data) ? data.data.length : undefined;

      return {
        success: true,
        message: "Соединение успешно установлено",
        modelsCount: count,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Ошибка сети при запросе к ${url}: ${msg}` };
    }
  }

  /**
   * Нормализация и сортировка списка моделей, полученных от провайдера.
   */
  parseModelsList(modelsList: unknown[]): AvailableModelItem[] {
    const models: AvailableModelItem[] = [];

    for (const raw of modelsList) {
      if (typeof raw !== "object" || raw === null) continue;
      const item = raw as { id?: unknown; display_name?: unknown; name?: unknown };
      const rawId = typeof item.id === "string" ? item.id : "";
      if (!rawId) continue;

      const cleanId = rawId.startsWith("models/") ? rawId.replace(/^models\//, "") : rawId;
      const displayName =
        (typeof item.display_name === "string" && item.display_name) ||
        (typeof item.name === "string" && item.name) ||
        cleanId;

      const lowerId = cleanId.toLowerCase();
      const lowerName = displayName.toLowerCase();
      const isEmbedding = lowerId.includes("embed") || lowerName.includes("embed");

      models.push({
        id: cleanId,
        name: displayName,
        type: isEmbedding ? "embedding" : "chat",
      });
    }

    const chatPriority = (id: string): number => {
      const l = id.toLowerCase();
      if (l.includes("3.5-flash-lite")) return 1;
      if (l.includes("3.5-flash")) return 2;
      if (l.includes("3.8-flash")) return 3;
      if (l.includes("3.7-flash")) return 4;
      if (l.includes("3.6-flash")) return 5;
      if (l.includes("3.1-pro")) return 6;
      if (l.includes("3.1-flash")) return 7;
      if (l.includes("2.5-pro")) return 8;
      if (l.includes("2.5-flash")) return 9;
      if (l.includes("gpt-4o-mini")) return 1;
      if (l.includes("gpt-4o")) return 2;
      if (l.includes("deepseek-chat")) return 1;
      if (l.includes("deepseek-reasoner")) return 2;
      if (
        l.includes("tts") ||
        l.includes("audio") ||
        l.includes("video") ||
        l.includes("veo") ||
        l.includes("robotics")
      ) {
        return 90;
      }
      return 20;
    };

    const embedPriority = (id: string): number => {
      const l = id.toLowerCase();
      if (l.includes("gemini-embedding-001")) return 1;
      if (l.includes("gemini-embedding-2")) return 2;
      if (l.includes("text-embedding-3-small")) return 1;
      if (l.includes("text-embedding-3-large")) return 2;
      return 10;
    };

    return models.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "chat" ? -1 : 1;
      }
      if (a.type === "chat") {
        return chatPriority(a.id) - chatPriority(b.id);
      }
      return embedPriority(a.id) - embedPriority(b.id);
    });
  }

  /**
   * Получение списка реально доступных моделей у провайдера через /models.
   */
  async fetchAvailableModels(override?: {
    baseUrl?: string;
    apiKey?: string;
    providerId?: string;
  }): Promise<{ success: boolean; models: AvailableModelItem[]; message?: string }> {
    const effective = await this.getEffectiveIntegrations();
    const provider = override?.providerId
      ? effective.llmProviders.find((p) => p.id === override.providerId)
      : effective.llmProviders.find((p) => p.isDefault) || effective.llmProviders[0];

    const url = (override?.baseUrl?.trim() || provider?.baseUrl || effective.llm.baseUrl)?.replace(/\/+$/, "");

    const candidateKeys: string[] = [];
    if (override?.apiKey && !override.apiKey.includes("•")) {
      candidateKeys.push(override.apiKey.trim());
    } else {
      if (provider?.apiKeys && provider.apiKeys.length > 0) {
        candidateKeys.push(...provider.apiKeys);
      }
      if (effective.llm.apiKey && !candidateKeys.includes(effective.llm.apiKey)) {
        candidateKeys.push(effective.llm.apiKey);
      }
    }

    if (!url || candidateKeys.length === 0) {
      return { success: false, models: [], message: "Не указан базовый URL или API-ключ провайдера" };
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { success: false, models: [], message: "Поддерживаются только протоколы http:// и https://" };
      }
      if (parsed.hostname === "169.254.169.254" || parsed.hostname === "metadata.google.internal") {
        return { success: false, models: [], message: "Запрос к адресам метаданных запрещен" };
      }
    } catch {
      return { success: false, models: [], message: "Указан некорректный URL провайдера" };
    }

    let lastErrorMsg = "";
    for (const key of candidateKeys) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(`${url}/models`, {
          headers: {
            Authorization: `Bearer ${key}`,
          },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          lastErrorMsg = `HTTP ${res.status}: ${text.slice(0, 150) || res.statusText}`;
          continue;
        }

        const data = (await res.json().catch(() => ({}))) as { data?: unknown[] };
        const rawList = Array.isArray(data?.data) ? data.data : [];
        const models = this.parseModelsList(rawList);

        return {
          success: true,
          models,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        lastErrorMsg = `Ошибка сети при запросе к ${url}: ${msg}`;
      }
    }

    return {
      success: false,
      models: [],
      message: `Не удалось загрузить модели (проверено ${candidateKeys.length} ключей): ${lastErrorMsg}`,
    };
  }

  /**
   * Проверка доступности ключей пула (валидность каждого ключа в отдельности).
   */
  async verifyProviderKeys(payload: {
    baseUrl?: string;
    providerId?: string;
    keys?: string[];
  }): Promise<VerifyProviderKeysResult> {
    const effective = await this.getEffectiveIntegrations();
    const provider = payload.providerId
      ? effective.llmProviders.find((p) => p.id === payload.providerId)
      : effective.llmProviders.find((p) => p.isDefault) || effective.llmProviders[0];

    const url = (payload.baseUrl?.trim() || provider?.baseUrl || effective.llm.baseUrl)?.replace(/\/+$/, "");

    if (!url) {
      return {
        success: false,
        summary: { total: 0, valid: 0, invalid: 0 },
        results: [],
        message: "Не указан базовый URL провайдера",
      };
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return {
          success: false,
          summary: { total: 0, valid: 0, invalid: 0 },
          results: [],
          message: "Поддерживаются только протоколы http:// и https://",
        };
      }
      if (parsed.hostname === "169.254.169.254" || parsed.hostname === "metadata.google.internal") {
        return {
          success: false,
          summary: { total: 0, valid: 0, invalid: 0 },
          results: [],
          message: "Запрос к адресам метаданных запрещен",
        };
      }
    } catch {
      return {
        success: false,
        summary: { total: 0, valid: 0, invalid: 0 },
        results: [],
        message: "Указан некорректный URL провайдера",
      };
    }

    const keysToCheck =
      payload.keys && payload.keys.length > 0
        ? payload.keys
        : provider?.apiKeys ?? (effective.llm.apiKey ? [effective.llm.apiKey] : []);

    if (keysToCheck.length === 0) {
      return {
        success: false,
        summary: { total: 0, valid: 0, invalid: 0 },
        results: [],
        message: "В пуле нет ключей для проверки",
      };
    }

    const unmaskedPairs = keysToCheck.map((rawKey, index) => {
      const trimmed = rawKey.trim();
      if (trimmed.includes("•")) {
        let restored = provider?.apiKeys[index];
        if (!restored && provider?.apiKeys) {
          restored = provider.apiKeys.find((orig) => maskApiKey(orig) === trimmed);
        }
        return {
          index,
          masked: maskApiKey(restored || trimmed),
          secret: restored?.trim() || "",
        };
      }
      return {
        index,
        masked: maskApiKey(trimmed),
        secret: trimmed,
      };
    });

    const results: KeyVerificationResult[] = [];
    let fetchedModels: AvailableModelItem[] | undefined;

    const chunkSize = 4;
    for (let c = 0; c < unmaskedPairs.length; c += chunkSize) {
      const chunk = unmaskedPairs.slice(c, c + chunkSize);
      await Promise.all(
        chunk.map(async (item) => {
          if (!item.secret) {
            results.push({
              index: item.index,
              maskedKey: item.masked,
              status: "invalid",
              message: "Ключ не найден в хранилище",
            });
            return;
          }

          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 7000);

            const res = await fetch(`${url}/models`, {
              headers: {
                Authorization: `Bearer ${item.secret}`,
              },
              signal: controller.signal,
            });
            clearTimeout(timeout);

            if (res.ok) {
              const data = (await res.json().catch(() => ({}))) as { data?: unknown[] };
              const modelsList = Array.isArray(data?.data) ? data.data : [];
              const count = modelsList.length;

              this.markKeyValid(item.secret);

              results.push({
                index: item.index,
                maskedKey: item.masked,
                status: "valid",
                statusCode: 200,
                message: `Работает (${count} моделей)`,
                modelsCount: count,
              });

              if (!fetchedModels && modelsList.length > 0) {
                fetchedModels = this.parseModelsList(modelsList);
              }
            } else {
              const text = await res.text().catch(() => "");
              let errDetail = "";
              try {
                const errObj = JSON.parse(text) as { error?: { message?: string } };
                if (errObj?.error?.message) {
                  errDetail = errObj.error.message;
                }
              } catch {
                errDetail = text.slice(0, 150);
              }

              if (isGoogleCloudPropagationDelay(res.status, `${errDetail} ${text}`)) {
                this.markKeyPendingActivation(item.secret);
                results.push({
                  index: item.index,
                  maskedKey: item.masked,
                  status: "pending_activation",
                  statusCode: res.status,
                  isTemporary: true,
                  message: `Активация в Google Cloud (синхронизация API 2–5 мин). Ключ сохранён, не удаляйте.`,
                });
              } else {
                let msg = `HTTP ${res.status}`;
                if (res.status === 400) {
                  msg = `Неверный API-ключ (400)${errDetail ? `: ${errDetail}` : ""}`;
                } else if (res.status === 401 || res.status === 403) {
                  msg = `Доступ запрещён (HTTP ${res.status})${errDetail ? `: ${errDetail}` : ""}`;
                } else if (res.status === 429) {
                  msg = `Превышена квота или лимит RPM (429)`;
                } else if (errDetail) {
                  msg = `HTTP ${res.status}: ${errDetail}`;
                }

                results.push({
                  index: item.index,
                  maskedKey: item.masked,
                  status: "invalid",
                  statusCode: res.status,
                  message: msg,
                });
              }
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            results.push({
              index: item.index,
              maskedKey: item.masked,
              status: "invalid",
              message: `Ошибка сети: ${msg}`,
            });
          }
        }),
      );
    }

    results.sort((a, b) => a.index - b.index);

    const validCount = results.filter((r) => r.status === "valid").length;
    const pendingCount = results.filter((r) => r.status === "pending_activation").length;
    const invalidCount = results.filter((r) => r.status === "invalid").length;

    return {
      success: invalidCount === 0,
      summary: {
        total: results.length,
        valid: validCount,
        invalid: invalidCount,
        pendingActivation: pendingCount,
      },
      results,
      models: fetchedModels,
    };
  }

  /**
   * Быстрое сохранение одиночного валидного ключа с немедленной активацией провайдера.
   */
  async saveSingleWorkingKey(providerType: LlmProviderType, key: string, baseUrl?: string): Promise<void> {
    this.cachedEffective = null;
    this.cacheExpiresAt = 0;
    this.markKeyValid(key);

    await runWithPlatformScope(async () => {
      const current = await queryOne<PlatformIntegrationsRow>(
        `SELECT * FROM platform_integrations_config WHERE id = 'default'`,
      );

      let providers: LlmProviderStoredItem[] = [];
      if (Array.isArray(current?.llm_providers)) {
        providers = [...(current.llm_providers as LlmProviderStoredItem[])];
      }

      const existingIdx = providers.findIndex(
        (p) => p.providerType === providerType || p.id === `prov-${providerType}`,
      );
      const cleanKey = key.trim();

      if (existingIdx >= 0) {
        const target = providers[existingIdx]!;
        const keys = target.apiKeys ? [...target.apiKeys] : [];
        if (!keys.includes(cleanKey)) {
          keys.unshift(cleanKey);
        }
        providers[existingIdx] = {
          ...target,
          apiKeys: keys,
          isActive: true,
          isDefault: true,
          baseUrl: baseUrl || target.baseUrl,
        };
      } else {
        providers.unshift({
          id: `prov-${providerType}`,
          name: providerType === "gemini" ? "Google Gemini" : providerType,
          providerType,
          baseUrl: baseUrl || "https://generativelanguage.googleapis.com/v1beta/openai",
          apiKeys: [cleanKey],
          chatModel: "gemini-3.5-flash",
          embeddingModel: "gemini-embedding-001",
          isActive: true,
          isDefault: true,
        });
      }

      await query(
        `UPDATE platform_integrations_config
         SET llm_providers = $1,
             llm_api_key = $2,
             llm_api_base_url = COALESCE($3, llm_api_base_url),
             updated_at = now()
         WHERE id = 'default'`,
        [JSON.stringify(providers), cleanKey, baseUrl ?? null],
      );
    });

    this.cachedEffective = null;
    this.cacheExpiresAt = 0;
  }

  /**
   * Удаление неработающих/битых ключей из пула.
   * Ключи в состоянии pending_activation (ожидающие синхронизации Google Cloud) защищены от удаления.
   */
  async removeInvalidKeys(providerId: string, invalidKeys: string[]): Promise<number> {
    this.cachedEffective = null;
    this.cacheExpiresAt = 0;

    // Никогда не удаляем ключи, которые находятся в стадии активации/синхронизации IAM
    const trulyInvalidKeys = invalidKeys.filter((k) => !this.isKeyPendingActivation(k));
    const invalidSet = new Set(trulyInvalidKeys.map((k) => k.trim()));
    for (const k of trulyInvalidKeys) {
      this.markKeyInvalid(k);
    }

    let removedCount = 0;
    await runWithPlatformScope(async () => {
      const current = await queryOne<PlatformIntegrationsRow>(
        `SELECT * FROM platform_integrations_config WHERE id = 'default'`,
      );

      let providers: LlmProviderStoredItem[] = [];
      if (Array.isArray(current?.llm_providers)) {
        providers = [...(current.llm_providers as LlmProviderStoredItem[])];
      }

      const idx = providers.findIndex(
        (p) => p.id === providerId || (providerId === "gemini" && p.providerType === "gemini"),
      );
      if (idx >= 0) {
        const target = providers[idx]!;
        const initialLen = target.apiKeys.length;
        const remainingKeys = target.apiKeys.filter(
          (k) => !invalidSet.has(k.trim()) && !invalidSet.has(maskApiKey(k)),
        );
        removedCount = initialLen - remainingKeys.length;

        providers[idx] = {
          ...target,
          apiKeys: remainingKeys,
        };

        await query(
          `UPDATE platform_integrations_config
           SET llm_providers = $1,
               updated_at = now()
           WHERE id = 'default'`,
          [JSON.stringify(providers)],
        );
      }
    });

    this.cachedEffective = null;
    this.cacheExpiresAt = 0;
    return removedCount;
  }
}

export const platformConfigService = new PlatformConfigService();
