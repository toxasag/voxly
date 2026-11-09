import { getRedisClient, isRedisAvailable } from "../../infrastructure/redis.js";

export interface CompanyInnLookupResult {
  inn: string;
  name: string;
  fullName?: string;
  kpp?: string;
  ogrn?: string;
  legalAddress?: string;
  directorName?: string;
  directorPost?: string;
  type: "LEGAL" | "INDIVIDUAL";
}

interface DaDataPartySuggestion {
  value: string;
  data: {
    inn: string;
    kpp?: string;
    ogrn?: string;
    type?: "LEGAL" | "INDIVIDUAL";
    name?: {
      full_with_opf?: string;
      short_with_opf?: string;
      latin?: string;
    };
    address?: {
      value?: string;
    };
    management?: {
      name?: string;
      post?: string;
    };
  };
}

interface EgrulRow {
  c?: string; // Краткое наименование
  n?: string; // Полное наименование или ФИО
  i?: string; // ИНН
  p?: string; // КПП
  o?: string; // ОГРН / ОГРНИП
  g?: string; // Должность и ФИО руководителя
  k?: string; // 'ul' | 'fl'
  rn?: string; // Регион
  a?: string; // Адрес
}

export class InnLookupService {
  private readonly CACHE_TTL_SECONDS = 86400; // 24 часа

  /**
   * Сквозной поиск реквизитов организации по ИНН (10 или 12 цифр).
   * 1. Проверяет Redis-кэш.
   * 2. Если задан DADATA_API_KEY — запрашивает DaData API.
   * 3. Fallback: официальный открытый реестр ФНС (egrul.nalog.ru).
   * 4. Кэширует результат в Redis на 24 часа.
   */
  async lookup(rawInn: string): Promise<CompanyInnLookupResult | null> {
    const inn = rawInn.replace(/\D/g, "").trim();
    if (inn.length !== 10 && inn.length !== 12) {
      return null;
    }

    // 1. Проверка Redis кэша
    const cacheKey = `cache:inn:${inn}`;
    const redis = isRedisAvailable() ? getRedisClient() : null;
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as CompanyInnLookupResult;
        }
      } catch (err) {
        console.warn("[InnLookupService] Redis read error:", err);
      }
    }

    let result: CompanyInnLookupResult | null = null;

    // 2. DaData API (если настроен API-ключ)
    const dadataKey = process.env.DADATA_API_KEY?.trim();
    if (dadataKey) {
      try {
        result = await this.lookupViaDaData(inn, dadataKey);
      } catch (err) {
        console.warn("[InnLookupService] DaData error, falling back to egrul.nalog.ru:", err);
      }
    }

    // 3. Fallback: egrul.nalog.ru
    if (!result) {
      try {
        result = await this.lookupViaEgrul(inn);
      } catch (err) {
        console.error("[InnLookupService] egrul.nalog.ru lookup error:", err);
      }
    }

    // 4. Кэширование успешного результата
    if (result && redis) {
      try {
        await redis.set(cacheKey, JSON.stringify(result), "EX", this.CACHE_TTL_SECONDS);
      } catch (err) {
        console.warn("[InnLookupService] Redis write error:", err);
      }
    }

    return result;
  }

  private async lookupViaDaData(inn: string, apiKey: string): Promise<CompanyInnLookupResult | null> {
    const response = await fetch("https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Token ${apiKey}`,
      },
      body: JSON.stringify({ query: inn }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`DaData responded with status ${response.status}`);
    }

    const json = (await response.json()) as { suggestions?: DaDataPartySuggestion[] };
    const first = json.suggestions?.[0];
    if (!first) return null;

    const data = first.data;
    const isIndividual = data.type === "INDIVIDUAL" || inn.length === 12;

    return {
      inn: data.inn || inn,
      name: data.name?.short_with_opf || first.value || data.name?.full_with_opf || "Организация",
      fullName: data.name?.full_with_opf,
      kpp: data.kpp,
      ogrn: data.ogrn,
      legalAddress: data.address?.value,
      directorName: data.management?.name,
      directorPost: data.management?.post,
      type: isIndividual ? "INDIVIDUAL" : "LEGAL",
    };
  }

  private async lookupViaEgrul(inn: string): Promise<CompanyInnLookupResult | null> {
    // Шаг 1: инициализируем поиск и получаем токен
    const initResponse = await fetch("https://egrul.nalog.ru/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ query: inn }),
      signal: AbortSignal.timeout(7000),
    });

    if (!initResponse.ok) {
      throw new Error(`egrul.nalog.ru init failed: ${initResponse.status}`);
    }

    const initJson = (await initResponse.json()) as { t?: string; ERRORS?: Record<string, unknown> };
    if (!initJson.t) {
      return null;
    }

    // Небольшая задержка перед запросом результата, если ФНС требует обработку
    const token = initJson.t;
    const resultUrl = `https://egrul.nalog.ru/search-result/${token}`;

    const resResponse = await fetch(resultUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(7000),
    });

    if (!resResponse.ok) {
      throw new Error(`egrul.nalog.ru search-result failed: ${resResponse.status}`);
    }

    const resJson = (await resResponse.json()) as { rows?: EgrulRow[] };
    const row = resJson.rows?.[0];
    if (!row) {
      return null;
    }

    const isIndividual = row.k === "fl" || inn.length === 12;

    let directorName: string | undefined;
    let directorPost: string | undefined;
    if (row.g) {
      const parts = row.g.split(":");
      if (parts.length > 1) {
        directorPost = parts[0]?.trim();
        directorName = parts.slice(1).join(":").trim();
      } else {
        directorName = row.g.trim();
      }
    } else if (isIndividual && row.n) {
      directorName = row.n;
    }

    const shortName = isIndividual
      ? (row.n?.startsWith("ИП") ? row.n : `ИП ${row.n ?? ""}`.trim())
      : (row.c || row.n || "Организация");

    return {
      inn: row.i || inn,
      name: shortName,
      fullName: row.n,
      kpp: row.p,
      ogrn: row.o,
      legalAddress: row.a || row.rn,
      directorName,
      directorPost,
      type: isIndividual ? "INDIVIDUAL" : "LEGAL",
    };
  }
}

export const innLookupService = new InnLookupService();
