import type { FastifyRequest, FastifyReply } from "fastify";
import { getEnv } from "../../config/env.js";

export const REFRESH_COOKIE_NAME = "getvoxly_refresh";
export const AUTH_COOKIE_NAME = "getvoxly_auth_token";

/** 60 дней в секундах: 60 * 24 * 60 * 60 = 5_184_000 */
export const REFRESH_COOKIE_MAX_AGE_SECONDS = 60 * 24 * 60 * 60;

/**
 * Определение домена для Cookie (.getvoxly.ru для всех поддоменов, либо пустая строка для localhost/IP).
 */
export function getCookieDomain(request: FastifyRequest): string {
  const host =
    (request.headers["x-forwarded-host"] as string | undefined) ||
    (request.headers.host as string | undefined) ||
    request.hostname ||
    "";
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";

  // IP-адреса и localhost не должны нести атрибут Domain
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname === "localhost" || hostname === "127.0.0.1") {
    return "";
  }

  const labels = hostname.split(".");
  if (labels.length < 2) return "";

  // getvoxly.ru от api.getvoxly.ru, valera.getvoxly.ru или getvoxly.ru
  const parent = labels.slice(-2).join(".");
  return `; Domain=.${parent}`;
}

/**
 * Разбор строки заголовка Cookie без внешних зависимостей.
 */
export function parseCookies(cookieHeader?: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName) {
      cookies[rawName] = decodeURIComponent(rest.join("="));
    }
  }
  return cookies;
}

/**
 * Выставление долгоживущих защищенных cookies:
 * 1. getvoxly_refresh: HttpOnly, Secure, SameSite=Lax, Max-Age=60d (безопасное хранение refresh_token)
 * 2. getvoxly_auth_token: Secure, SameSite=Lax, Max-Age=60d (маркер активной сессии для Next.js Edge Middleware)
 */
export function setAuthCookies(
  request: FastifyRequest,
  reply: FastifyReply,
  tokens: { access_token: string; refresh_token: string },
): void {
  const domainAttr = getCookieDomain(request);
  const isSecure =
    request.protocol === "https" ||
    request.headers["x-forwarded-proto"] === "https" ||
    getEnv().NODE_ENV === "production";
  const secureAttr = isSecure ? "; Secure" : "";

  const cookies = [
    `${REFRESH_COOKIE_NAME}=${encodeURIComponent(tokens.refresh_token)}; Path=/; Max-Age=${REFRESH_COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${domainAttr}${secureAttr}`,
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(tokens.access_token)}; Path=/; Max-Age=${REFRESH_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${domainAttr}${secureAttr}`,
  ];

  if (domainAttr) {
    cookies.push(
      `${REFRESH_COOKIE_NAME}=${encodeURIComponent(tokens.refresh_token)}; Path=/; Max-Age=${REFRESH_COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secureAttr}`,
      `${AUTH_COOKIE_NAME}=${encodeURIComponent(tokens.access_token)}; Path=/; Max-Age=${REFRESH_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secureAttr}`,
    );
  }

  reply.header("Set-Cookie", cookies);
}

/**
 * Очистка авторизационных cookies (при logout).
 */
export function clearAuthCookies(request: FastifyRequest, reply: FastifyReply): void {
  const domainAttr = getCookieDomain(request);
  const isSecure =
    request.protocol === "https" ||
    request.headers["x-forwarded-proto"] === "https" ||
    getEnv().NODE_ENV === "production";
  const secureAttr = isSecure ? "; Secure" : "";

  const cookies = [
    `${REFRESH_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${domainAttr}${secureAttr}`,
    `${AUTH_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax${domainAttr}${secureAttr}`,
    `${REFRESH_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureAttr}`,
    `${AUTH_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax${secureAttr}`,
  ];

  reply.header("Set-Cookie", cookies);
}
