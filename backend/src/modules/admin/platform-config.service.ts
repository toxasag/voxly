import { getEnv } from "../../config/env.js";
import { queryOne, runWithPlatformScope } from "../../db/client.js";

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
  updatedAt: string;
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
  updated_at: Date | string;
}

export class PlatformConfigService {
  private cachedEffective: EffectiveIntegrations | null = null;
  private cacheExpiresAt = 0;

  isLlmConfiguredSync(): boolean {
    if (this.cachedEffective) {
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
    return Boolean(env.ROBOKASSA_MERCHANT_LOGIN && env.ROBOKASSA_PASSWORD_1 && env.ROBOKASSA_PASSWORD_2);
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
    const rLogin = (dbRow?.robokassa_login?.trim()) || env.ROBOKASSA_MERCHANT_LOGIN || null;
    const rPass1 = (dbRow?.robokassa_password_1?.trim()) || env.ROBOKASSA_PASSWORD_1 || null;
    const rPass2 = (dbRow?.robokassa_password_2?.trim()) || env.ROBOKASSA_PASSWORD_2 || null;
    const rIsTest = dbRow ? dbRow.robokassa_is_test : env.ROBOKASSA_IS_TEST;
    const rHashAlgo = ((dbRow?.robokassa_hash_algo === "MD5" || env.ROBOKASSA_HASH_ALGO === "MD5") ? "MD5" : "SHA256") as "SHA256" | "MD5";
    const rTax = dbRow?.robokassa_tax || env.ROBOKASSA_TAX || "none";

    const isRoboConfigured = !!(rLogin && rPass1 && rPass2);

    // LLM: сначала БД, затем env
    const llmUrl = (dbRow?.llm_api_base_url?.trim()) || env.LLM_API_BASE_URL || null;
    const llmKey = (dbRow?.llm_api_key?.trim()) || env.LLM_API_KEY || null;
    const llmEmbedModel = (dbRow?.llm_embedding_model?.trim()) || env.LLM_EMBEDDING_MODEL || "text-embedding-3-small";
    const llmChatModel = (dbRow?.llm_chat_model?.trim()) || "openai/gpt-4o-mini";

    const isLlmConfigured = !!(llmUrl && llmKey);

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
    };

    this.cachedEffective = result;
    this.cacheExpiresAt = now + 15_000;

    return result;
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
        if (payload.robokassa.password1 !== undefined && payload.robokassa.password1.trim() && !payload.robokassa.password1.includes("•")) {
          nextPass1 = payload.robokassa.password1.trim();
        }
        if (payload.robokassa.password2 !== undefined && payload.robokassa.password2.trim() && !payload.robokassa.password2.includes("•")) {
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

      // LLM values
      let nextLlmUrl = current?.llm_api_base_url ?? null;
      let nextLlmKey = current?.llm_api_key ?? null;
      let nextLlmEmbedModel = current?.llm_embedding_model ?? "text-embedding-3-small";
      let nextLlmChatModel = current?.llm_chat_model ?? "openai/gpt-4o-mini";

      if (payload.llm) {
        if (payload.llm.baseUrl !== undefined) {
          nextLlmUrl = payload.llm.baseUrl.trim() || null;
        }
        if (payload.llm.apiKey !== undefined && payload.llm.apiKey.trim() && !payload.llm.apiKey.includes("•")) {
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
          llm_api_base_url, llm_api_key, llm_embedding_model, llm_chat_model, updated_at
        ) VALUES (
          'default', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now()
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
        ],
      );
    });

    return this.getIntegrationsConfig();
  }

  /**
   * Тестовая проверка подключения к LLM-провайдеру.
   */
  async testLlmConnection(override?: { baseUrl?: string; apiKey?: string }): Promise<{ success: boolean; message: string; modelsCount?: number }> {
    const effective = await this.getEffectiveIntegrations();
    const url = (override?.baseUrl?.trim() || effective.llm.baseUrl)?.replace(/\/+$/, "");
    const key = (override?.apiKey?.trim() || effective.llm.apiKey);

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
}

export const platformConfigService = new PlatformConfigService();
