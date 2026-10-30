/**
 * Source Attribution and Visitor Metadata Utilities
 * Provides parsing, normalization, and fallback resolution for Deals and Contacts.
 */

export interface ParsedSourceMetadata {
  device: {
    deviceType: "mobile" | "tablet" | "desktop";
    os: string;
    browser: string;
    screen?: string;
    platform?: string;
    rawUserAgent?: string;
  };
  page: {
    url: string;
    title: string;
    domain: string;
  };
  utm: Record<string, string>;
  clickIds: Record<string, string>;
  referrer: string;
  network: {
    ip?: string;
    city?: string;
    country?: string;
  };
  analytics: {
    yandexuid?: string;
    ymUid?: string;
    gaId?: string;
    fbId?: string;
    tmrLvid?: string;
  };
  firstSeenAt?: string;
  visitCount?: number;
  pageHistory: Array<{ step?: number; time?: string; url: string }>;
}

export function parseUserAgentString(ua: string): {
  deviceType: "mobile" | "tablet" | "desktop";
  os: string;
  browser: string;
} {
  if (!ua) {
    return { deviceType: "desktop", os: "Неизвестно", browser: "Неизвестно" };
  }

  const uaLower = ua.toLowerCase();

  // 1. Device Type
  let deviceType: "mobile" | "tablet" | "desktop" = "desktop";
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    deviceType = "tablet";
  } else if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/i.test(ua)) {
    deviceType = "mobile";
  }

  // 2. OS
  let os = "Неизвестно";
  if (/windows phone/i.test(ua)) os = "Windows Phone";
  else if (/windows nt 10\.0/i.test(ua)) os = "Windows 10/11";
  else if (/windows nt 6\.3/i.test(ua)) os = "Windows 8.1";
  else if (/windows nt 6\.2/i.test(ua)) os = "Windows 8";
  else if (/windows nt 6\.1/i.test(ua)) os = "Windows 7";
  else if (/windows/i.test(ua)) os = "Windows";
  else if (/android/i.test(ua)) {
    const match = ua.match(/android\s([0-9.]+)/i);
    os = match ? `Android ${match[1]}` : "Android";
  } else if (/iphone|ipad|ipod/i.test(ua)) {
    const match = ua.match(/os\s([0-9_]+)/i);
    os = match ? `iOS ${match[1].replace(/_/g, ".")}` : "iOS";
  } else if (/mac os x/i.test(ua)) {
    const match = ua.match(/mac os x\s([0-9_.]+)/i);
    os = match ? `macOS ${match[1].replace(/_/g, ".")}` : "macOS";
  } else if (/cros/i.test(ua)) os = "Chrome OS";
  else if (/linux/i.test(ua)) os = "Linux";

  // 3. Browser
  let browser = "Неизвестно";
  if (/yabrowser\/([0-9.]+)/i.test(ua)) {
    const m = ua.match(/yabrowser\/([0-9.]+)/i);
    browser = `Яндекс Браузер ${m ? m[1].split(".")[0] : ""}`.trim();
  } else if (/edg\/([0-9.]+)/i.test(ua)) {
    const m = ua.match(/edg\/([0-9.]+)/i);
    browser = `Microsoft Edge ${m ? m[1].split(".")[0] : ""}`.trim();
  } else if (/opr\/([0-9.]+)/i.test(ua) || /opera/i.test(ua)) {
    const m = ua.match(/opr\/([0-9.]+)/i);
    browser = `Opera ${m ? m[1].split(".")[0] : ""}`.trim();
  } else if (/samsungbrowser\/([0-9.]+)/i.test(ua)) {
    const m = ua.match(/samsungbrowser\/([0-9.]+)/i);
    browser = `Samsung Internet ${m ? m[1].split(".")[0] : ""}`.trim();
  } else if (/chrome\/([0-9.]+)/i.test(ua)) {
    const m = ua.match(/chrome\/([0-9.]+)/i);
    browser = `Google Chrome ${m ? m[1].split(".")[0] : ""}`.trim();
  } else if (/version\/([0-9.]+).*safari/i.test(ua)) {
    const m = ua.match(/version\/([0-9.]+).*safari/i);
    browser = `Safari ${m ? m[1].split(".")[0] : ""}`.trim();
  } else if (/firefox\/([0-9.]+)/i.test(ua)) {
    const m = ua.match(/firefox\/([0-9.]+)/i);
    browser = `Firefox ${m ? m[1].split(".")[0] : ""}`.trim();
  }

  return { deviceType, os, browser };
}

function extractDomain(urlStr?: string): string {
  if (!urlStr) return "";
  try {
    return new URL(urlStr).hostname;
  } catch {
    return "";
  }
}

function extractUtmAndClickIdsFromUrlString(urlString?: string): {
  utmTags: Record<string, string>;
  clickIds: Record<string, string>;
} {
  const utmTags: Record<string, string> = {};
  const clickIds: Record<string, string> = {};
  if (!urlString) return { utmTags, clickIds };

  try {
    const url = new URL(urlString);
    url.searchParams.forEach((val, key) => {
      const lower = key.toLowerCase();
      if (lower.startsWith("utm_")) {
        utmTags[lower] = val;
      } else if (
        [
          "yclid",
          "gclid",
          "fbclid",
          "vkclid",
          "ttclid",
          "msclkid",
          "dclid",
          "wbraid",
          "gbraid",
          "ym_client_id",
          "openstat",
        ].includes(lower)
      ) {
        clickIds[lower] = val;
      }
    });
  } catch {
    // ignore
  }

  return { utmTags, clickIds };
}

export function resolveSourceMetadata(entity?: {
  sourceMetadata?: Record<string, unknown> | null;
  customFields?: Record<string, unknown> | null;
  createdAt?: string;
}): ParsedSourceMetadata {
  const sm = (entity?.sourceMetadata || {}) as Record<string, unknown>;
  const cf = (entity?.customFields || {}) as Record<string, unknown>;

  // Device
  const rawDevice = (sm.device as Record<string, unknown> | undefined) || {};
  const rawUa =
    (rawDevice.rawUserAgent as string | undefined) ||
    (cf.user_agent as string | undefined) ||
    (cf.userAgent as string | undefined) ||
    "";
  const parsedUa = rawUa ? parseUserAgentString(rawUa) : null;

  const deviceTypeStr =
    (rawDevice.deviceType as string | undefined) ||
    (cf.device_type as string | undefined) ||
    parsedUa?.deviceType ||
    "desktop";
  const deviceType: "mobile" | "tablet" | "desktop" =
    deviceTypeStr === "mobile" || deviceTypeStr === "tablet" ? deviceTypeStr : "desktop";

  const os =
    (rawDevice.os as string | undefined) ||
    (cf.os as string | undefined) ||
    parsedUa?.os ||
    "Неизвестно";
  const browser =
    (rawDevice.browser as string | undefined) ||
    (cf.browser as string | undefined) ||
    parsedUa?.browser ||
    "Неизвестно";
  const screen =
    (rawDevice.screen as string | undefined) ||
    (cf.screen_resolution as string | undefined) ||
    (cf.screen as string | undefined) ||
    undefined;
  const platform =
    (rawDevice.platform as string | undefined) ||
    (cf.platform as string | undefined) ||
    undefined;

  // Page
  const rawPage = (sm.page as Record<string, unknown> | undefined) || {};
  const pageUrl =
    (rawPage.url as string | undefined) ||
    (cf.page_url as string | undefined) ||
    (cf.pageUrl as string | undefined) ||
    "";
  const pageTitle =
    (rawPage.title as string | undefined) ||
    (cf.page_title as string | undefined) ||
    (cf.pageTitle as string | undefined) ||
    "";
  const pageDomain =
    (rawPage.domain as string | undefined) ||
    extractDomain(pageUrl);

  // Referrer
  const referrer =
    (sm.referrer as string | undefined) ||
    (cf.referrer as string | undefined) ||
    "";

  // UTM & Click IDs
  const parsedFromPage = extractUtmAndClickIdsFromUrlString(pageUrl);
  const parsedFromRef = extractUtmAndClickIdsFromUrlString(referrer);

  const rawUtm = (sm.utm as Record<string, string> | undefined) || {};
  const cfUtm = (cf.utm_tags as Record<string, string> | undefined) || {};
  const utm: Record<string, string> = {
    ...parsedFromRef.utmTags,
    ...parsedFromPage.utmTags,
    ...cfUtm,
    ...rawUtm,
  };

  // Add individual UTM fields from cf if available
  const utmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
  utmKeys.forEach((k) => {
    if (cf[k] && typeof cf[k] === "string" && !utm[k]) {
      utm[k] = cf[k] as string;
    }
  });

  const rawClickIds = (sm.clickIds as Record<string, string> | undefined) || {};
  const cfClickIds = (cf.click_ids as Record<string, string> | undefined) || {};
  const clickIds: Record<string, string> = {
    ...parsedFromRef.clickIds,
    ...parsedFromPage.clickIds,
    ...cfClickIds,
    ...rawClickIds,
  };
  ["yclid", "gclid", "fbclid", "vkclid"].forEach((k) => {
    if (cf[k] && typeof cf[k] === "string" && !clickIds[k]) {
      clickIds[k] = cf[k] as string;
    }
  });

  // Network
  const rawNetwork = (sm.network as Record<string, unknown> | undefined) || {};
  const ip =
    (rawNetwork.ip as string | undefined) ||
    (cf.ip as string | undefined) ||
    (cf.client_ip as string | undefined) ||
    undefined;
  const city =
    (rawNetwork.city as string | undefined) ||
    (cf.city as string | undefined) ||
    undefined;
  const country =
    (rawNetwork.country as string | undefined) ||
    (cf.country as string | undefined) ||
    undefined;

  // Analytics
  const rawAnalytics = (sm.analytics as Record<string, string | undefined> | undefined) || {};
  const analytics = {
    yandexuid: rawAnalytics.yandexuid || (cf.yandexuid as string | undefined),
    ymUid: rawAnalytics.ymUid || (cf.ym_uid as string | undefined) || (cf.ymUid as string | undefined),
    gaId: rawAnalytics.gaId || (cf.ga_id as string | undefined) || (cf.gaId as string | undefined),
    fbId: rawAnalytics.fbId || (cf.fb_id as string | undefined) || (cf.fbId as string | undefined),
    tmrLvid: rawAnalytics.tmrLvid || (cf.tmr_lvid as string | undefined),
  };

  // First seen & counts
  const firstSeenAt =
    (sm.firstSeenAt as string | undefined) ||
    (cf.first_seen_at as string | undefined) ||
    entity?.createdAt;

  const visitCount =
    typeof sm.visitCount === "number"
      ? sm.visitCount
      : typeof cf.visit_count === "number"
      ? cf.visit_count
      : undefined;

  const rawHistory = (sm.pageHistory as Array<{ step?: number; time?: string; url: string }> | undefined) ||
    (cf.page_history as Array<{ step?: number; time?: string; url: string }> | undefined) ||
    [];

  return {
    device: {
      deviceType,
      os,
      browser,
      screen,
      platform,
      rawUserAgent: rawUa || undefined,
    },
    page: {
      url: pageUrl,
      title: pageTitle,
      domain: pageDomain,
    },
    utm,
    clickIds,
    referrer,
    network: {
      ip,
      city,
      country,
    },
    analytics,
    firstSeenAt,
    visitCount,
    pageHistory: Array.isArray(rawHistory) ? rawHistory : [],
  };
}

export function hasSourceMetadataContent(data: ParsedSourceMetadata): boolean {
  return Boolean(
    data.page.url ||
    data.page.domain ||
    Object.keys(data.utm).length > 0 ||
    Object.keys(data.clickIds).length > 0 ||
    data.referrer ||
    data.network.ip ||
    data.network.city ||
    data.device.rawUserAgent ||
    data.device.screen ||
    data.analytics.ymUid ||
    data.analytics.gaId ||
    data.analytics.yandexuid
  );
}
