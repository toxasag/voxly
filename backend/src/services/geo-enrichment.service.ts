import { getRedisClient } from "../infrastructure/redis.js";

export interface CoordinatesInput {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface VisitorGeoData {
  ip?: string;
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  district?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  timezone?: string;
  isp?: string;
  sourceType: "ip" | "gps" | "hybrid" | "local" | "unknown";
  provider?: string;
  resolvedAt?: string;
  mapUrl?: string;
}

interface CacheEntry {
  data: VisitorGeoData;
  expiresAt: number;
}

/**
 * Проверка на локальный / приватный IP (Bogon / Loopback / LAN).
 */
export function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  const trimmed = ip.trim().toLowerCase();
  if (
    trimmed === "::1" ||
    trimmed === "localhost" ||
    trimmed === "127.0.0.1" ||
    trimmed === "0.0.0.0"
  ) {
    return true;
  }
  if (trimmed.startsWith("10.") || trimmed.startsWith("192.168.") || trimmed.startsWith("169.254.")) {
    return true;
  }
  const match172 = trimmed.match(/^172\.(\d+)\./);
  if (match172) {
    const second = parseInt(match172[1] ?? "0", 10);
    if (second >= 16 && second <= 31) return true;
  }
  if (trimmed.startsWith("fc00:") || trimmed.startsWith("fd00:") || trimmed.startsWith("fe80:")) {
    return true;
  }
  return false;
}

/**
 * Очистка и извлечение валидного IP из заголовка (удаление портов и пробелов).
 */
export function cleanIpAddress(rawIp: string | null | undefined): string | null {
  if (!rawIp) return null;
  const first = rawIp.split(",")[0]?.trim() ?? "";
  if (!first) return null;
  // Удаляем порт, если присутствует в IPv4 (например, 1.2.3.4:5678)
  const ipv4WithPort = first.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+$/);
  if (ipv4WithPort && ipv4WithPort[1]) {
    return ipv4WithPort[1];
  }
  return first;
}

/**
 * Отказоустойчивый сервис обогащения геолокации и обратного геокодинга.
 * Поддерживает:
 * - Пассивный IP-lookup (ip-api.com с фоллбэками на freeipapi и ipwhois)
 * - Активный точный GPS-геокодинг (OpenStreetMap Nominatim в понятный адрес на русском языке)
 * - Двухуровневое кэширование (Redis + in-memory fallback с TTL 24 часа)
 * - Защиту от зависания (жесткий timeout 1500 мс на внешние запросы)
 */
export class GeoEnrichmentService {
  private static readonly memoryCache = new Map<string, CacheEntry>();
  private static readonly MAX_MEMORY_ITEMS = 5000;
  private static readonly CACHE_TTL_SECONDS = 86400; // 24 часа

  private readonly log?: {
    info: (obj: object, msg: string) => void;
    warn: (obj: object, msg: string) => void;
    error: (obj: object, msg: string) => void;
  };

  constructor(logger?: {
    info: (obj: object, msg: string) => void;
    warn: (obj: object, msg: string) => void;
    error: (obj: object, msg: string) => void;
  }) {
    this.log = logger;
  }

  /**
   * Получение значения из кэша (Redis -> Memory).
   */
  private async getFromCache(key: string): Promise<VisitorGeoData | null> {
    const redis = getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(key);
        if (cached) {
          return JSON.parse(cached) as VisitorGeoData;
        }
      } catch {
        // Ошибка Redis не должна ломать пайплайн
      }
    }

    const mem = GeoEnrichmentService.memoryCache.get(key);
    if (mem) {
      if (mem.expiresAt > Date.now()) {
        return mem.data;
      }
      GeoEnrichmentService.memoryCache.delete(key);
    }

    return null;
  }

  /**
   * Запись значения в кэш (Redis + Memory).
   */
  private async setInCache(key: string, data: VisitorGeoData): Promise<void> {
    const redis = getRedisClient();
    if (redis) {
      try {
        await redis.set(key, JSON.stringify(data), "EX", GeoEnrichmentService.CACHE_TTL_SECONDS);
      } catch {
        // Игнорируем ошибку Redis
      }
    }

    if (GeoEnrichmentService.memoryCache.size >= GeoEnrichmentService.MAX_MEMORY_ITEMS) {
      // Удаляем самые старые 500 записей
      const keysToDelete: string[] = [];
      let count = 0;
      for (const k of GeoEnrichmentService.memoryCache.keys()) {
        keysToDelete.push(k);
        count++;
        if (count >= 500) break;
      }
      for (const k of keysToDelete) {
        GeoEnrichmentService.memoryCache.delete(k);
      }
    }

    GeoEnrichmentService.memoryCache.set(key, {
      data,
      expiresAt: Date.now() + GeoEnrichmentService.CACHE_TTL_SECONDS * 1000,
    });
  }

  /**
   * Определение геолокации по IP-адресу с цепочкой фоллбэков.
   */
  async lookupIp(ip: string): Promise<VisitorGeoData | null> {
    const cleanIp = cleanIpAddress(ip);
    if (!cleanIp) return null;

    if (isPrivateIp(cleanIp)) {
      return {
        ip: cleanIp,
        country: "Локальная сеть",
        countryCode: "LOCAL",
        city: "Локальный хост",
        region: "Development",
        address: "Локальный хост (LAN/Dev)",
        sourceType: "local",
        provider: "local",
        resolvedAt: new Date().toISOString(),
      };
    }

    const cacheKey = `geo:ip:${cleanIp}`;
    const cached = await this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    // 1. Попытка через ip-api.com (на русском языке)
    let result = await this.tryIpApi(cleanIp);

    // 2. Фоллбэк 1: freeipapi.com
    if (!result) {
      result = await this.tryFreeIpApi(cleanIp);
    }

    // 3. Фоллбэк 2: ipwhois.app
    if (!result) {
      result = await this.tryIpWhois(cleanIp);
    }

    if (result) {
      this.log?.info({ ip: cleanIp, city: result.city, country: result.country }, "[GEO_IP] Resolved location");
      await this.setInCache(cacheKey, result);
    } else {
      this.log?.warn({ ip: cleanIp }, "[GEO_IP] Failed to resolve location");
    }

    return result;
  }

  private async tryIpApi(cleanIp: string): Promise<VisitorGeoData | null> {
    try {
      const url = `http://ip-api.com/json/${cleanIp}?lang=ru&fields=status,message,country,countryCode,regionName,city,zip,lat,lon,timezone,isp,query`;
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return null;

      const body = (await res.json()) as {
        status?: string;
        country?: string;
        countryCode?: string;
        regionName?: string;
        city?: string;
        lat?: number;
        lon?: number;
        timezone?: string;
        isp?: string;
      };

      if (body.status !== "success") return null;

      const country = body.country || "";
      const region = body.regionName || "";
      const city = body.city || "";
      const addressParts = [city, region !== city ? region : null, country].filter(Boolean);

      const lat = typeof body.lat === "number" ? body.lat : undefined;
      const lon = typeof body.lon === "number" ? body.lon : undefined;

      return {
        ip: cleanIp,
        country: country || undefined,
        countryCode: body.countryCode || undefined,
        region: region || undefined,
        city: city || undefined,
        address: addressParts.length > 0 ? addressParts.join(", ") : undefined,
        latitude: lat,
        longitude: lon,
        timezone: body.timezone || undefined,
        isp: body.isp || undefined,
        sourceType: "ip",
        provider: "ip-api",
        resolvedAt: new Date().toISOString(),
        mapUrl:
          lat !== undefined && lon !== undefined
            ? `https://yandex.ru/maps/?pt=${lon},${lat}&z=12&l=map`
            : undefined,
      };
    } catch {
      return null;
    }
  }

  private async tryFreeIpApi(cleanIp: string): Promise<VisitorGeoData | null> {
    try {
      const url = `https://freeipapi.com/api/json/${cleanIp}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return null;

      const body = (await res.json()) as {
        countryName?: string;
        countryCode?: string;
        regionName?: string;
        cityName?: string;
        latitude?: number;
        longitude?: number;
        timeZone?: string;
      };

      const country = body.countryName || "";
      const region = body.regionName || "";
      const city = body.cityName || "";
      const addressParts = [city, region !== city ? region : null, country].filter(Boolean);

      const lat = typeof body.latitude === "number" ? body.latitude : undefined;
      const lon = typeof body.longitude === "number" ? body.longitude : undefined;

      return {
        ip: cleanIp,
        country: country || undefined,
        countryCode: body.countryCode || undefined,
        region: region || undefined,
        city: city || undefined,
        address: addressParts.length > 0 ? addressParts.join(", ") : undefined,
        latitude: lat,
        longitude: lon,
        timezone: body.timeZone || undefined,
        sourceType: "ip",
        provider: "freeipapi",
        resolvedAt: new Date().toISOString(),
        mapUrl:
          lat !== undefined && lon !== undefined
            ? `https://yandex.ru/maps/?pt=${lon},${lat}&z=12&l=map`
            : undefined,
      };
    } catch {
      return null;
    }
  }

  private async tryIpWhois(cleanIp: string): Promise<VisitorGeoData | null> {
    try {
      const url = `https://ipwhois.app/json/${cleanIp}?lang=ru`;
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return null;

      const body = (await res.json()) as {
        success?: boolean;
        country?: string;
        country_code?: string;
        region?: string;
        city?: string;
        latitude?: number;
        longitude?: number;
        isp?: string;
      };

      if (!body.success) return null;

      const country = body.country || "";
      const region = body.region || "";
      const city = body.city || "";
      const addressParts = [city, region !== city ? region : null, country].filter(Boolean);

      const lat = typeof body.latitude === "number" ? body.latitude : undefined;
      const lon = typeof body.longitude === "number" ? body.longitude : undefined;

      return {
        ip: cleanIp,
        country: country || undefined,
        countryCode: body.country_code || undefined,
        region: region || undefined,
        city: city || undefined,
        address: addressParts.length > 0 ? addressParts.join(", ") : undefined,
        latitude: lat,
        longitude: lon,
        isp: body.isp || undefined,
        sourceType: "ip",
        provider: "ipwhois",
        resolvedAt: new Date().toISOString(),
        mapUrl:
          lat !== undefined && lon !== undefined
            ? `https://yandex.ru/maps/?pt=${lon},${lat}&z=12&l=map`
            : undefined,
      };
    } catch {
      return null;
    }
  }

  /**
   * Обратный геокодинг точных GPS-координат через OpenStreetMap Nominatim.
   */
  async reverseGeocode(coords: CoordinatesInput): Promise<VisitorGeoData | null> {
    const lat = coords.latitude;
    const lon = coords.longitude;
    if (typeof lat !== "number" || typeof lon !== "number" || isNaN(lat) || isNaN(lon)) {
      return null;
    }

    const cacheKey = `geo:coords:${lat.toFixed(4)},${lon.toFixed(4)}`;
    const cached = await this.getFromCache(cacheKey);
    if (cached) {
      return {
        ...cached,
        accuracy: coords.accuracy,
      };
    }

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=ru&zoom=18&addressdetails=1`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "GetVoxly-CRM/1.0 (contact@getvoxly.ru)",
        },
        signal: AbortSignal.timeout(1500),
      });

      if (!res.ok) {
        return {
          latitude: lat,
          longitude: lon,
          accuracy: coords.accuracy,
          address: `Координаты: ${lat.toFixed(5)}, ${lon.toFixed(5)}`,
          sourceType: "gps",
          provider: "gps-fallback",
          resolvedAt: new Date().toISOString(),
          mapUrl: `https://yandex.ru/maps/?pt=${lon},${lat}&z=16&l=map`,
        };
      }

      const body = (await res.json()) as {
        display_name?: string;
        address?: {
          country?: string;
          country_code?: string;
          state?: string;
          region?: string;
          city?: string;
          town?: string;
          village?: string;
          municipality?: string;
          suburb?: string;
          city_district?: string;
          neighbourhood?: string;
          road?: string;
          pedestrian?: string;
          street?: string;
          house_number?: string;
        };
      };

      const addr = body.address || {};
      const country = addr.country || "";
      const countryCode = addr.country_code ? addr.country_code.toUpperCase() : undefined;
      const region = addr.state || addr.region || "";
      const city = addr.city || addr.town || addr.village || addr.municipality || addr.state || "";
      const district = addr.suburb || addr.city_district || addr.neighbourhood || "";
      const road = addr.road || addr.pedestrian || addr.street || "";
      const houseNumber = addr.house_number || "";

      let formattedStreetHouse = "";
      if (road && houseNumber) {
        formattedStreetHouse = `${road}, д. ${houseNumber}`;
      } else if (road) {
        formattedStreetHouse = road;
      }

      const addressParts = [
        formattedStreetHouse || null,
        district || null,
        city || null,
        region && region !== city ? region : null,
        country || null,
      ].filter(Boolean);

      const humanAddress =
        addressParts.length > 0
          ? addressParts.join(", ")
          : body.display_name || `Координаты: ${lat.toFixed(5)}, ${lon.toFixed(5)}`;

      const geoData: VisitorGeoData = {
        country: country || undefined,
        countryCode,
        region: region || undefined,
        city: city || undefined,
        district: district || undefined,
        address: humanAddress,
        latitude: lat,
        longitude: lon,
        accuracy: coords.accuracy,
        sourceType: "gps",
        provider: "nominatim",
        resolvedAt: new Date().toISOString(),
        mapUrl: `https://yandex.ru/maps/?pt=${lon},${lat}&z=16&l=map`,
      };

      await this.setInCache(cacheKey, geoData);
      this.log?.info({ lat, lon, address: humanAddress }, "[GEO_GPS] Reverse geocoded coordinates");
      return geoData;
    } catch {
      return {
        latitude: lat,
        longitude: lon,
        accuracy: coords.accuracy,
        address: `Координаты: ${lat.toFixed(5)}, ${lon.toFixed(5)}`,
        sourceType: "gps",
        provider: "gps-fallback",
        resolvedAt: new Date().toISOString(),
        mapUrl: `https://yandex.ru/maps/?pt=${lon},${lat}&z=16&l=map`,
      };
    }
  }

  /**
   * Комплексное гибридное обогащение:
   * Если переданы точные GPS координаты — резолвит точный адрес через обратный геокодинг
   * и дополняет IP/ISP данными из пассивного lookup.
   * Если GPS нет — резолвит данные по IP.
   */
  async enrichLocation(params: {
    ip?: string | null;
    coords?: CoordinatesInput | null;
  }): Promise<VisitorGeoData | null> {
    const { ip, coords } = params;

    let gpsData: VisitorGeoData | null = null;
    if (coords && typeof coords.latitude === "number" && typeof coords.longitude === "number") {
      gpsData = await this.reverseGeocode(coords);
    }

    let ipData: VisitorGeoData | null = null;
    if (ip) {
      ipData = await this.lookupIp(ip);
    }

    // Если есть точный GPS — он является источником правды для адреса и координат,
    // но мы дополняем его IP-адресом и провайдером из IP-lookup
    if (gpsData) {
      return {
        ...gpsData,
        ip: ipData?.ip || cleanIpAddress(ip) || undefined,
        isp: ipData?.isp,
        timezone: ipData?.timezone,
        sourceType: "gps",
      };
    }

    if (ipData) {
      return ipData;
    }

    return null;
  }
}
