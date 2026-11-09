// ---------------------------------------------------------------------------
// API Client — typed wrapper around `fetch` for the GETVOXLY backend.
//
//  - Absolute base URL (the API is a separate origin from Next.js)
//  - Automatic `Authorization: Bearer <token>` header
//  - Transparent refresh-and-retry on 401
//  - Error normalisation to ApiClientError, with field-level details preserved
//    so forms can map VALIDATION_ERROR onto inputs
// ---------------------------------------------------------------------------

import {
  clearSession,
  getTokenRemainingSeconds,
  readAccessToken,
  readRefreshToken,
  writeTokens,
} from "@/lib/auth/session";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * The Fastify API runs on its own origin (default :4000), so a relative path
 * would hit the Next.js server instead. Trailing slashes are trimmed to keep
 * joined paths free of doubled separators.
 */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"
).replace(/\/+$/, "");

function buildUrl(path: string, query?: QueryParams): string {
  const base = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;

  if (query === undefined) return base;

  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    // Undefined, null and "" mean "filter not applied" — the backend treats a
    // missing key differently from an empty one, so they must not be sent.
    if (value === undefined || value === null || value === "") continue;
    search.append(key, String(value));
  }

  const qs = search.toString();
  return qs.length > 0 ? `${base}?${qs}` : base;
}

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

// ---------------------------------------------------------------------------
// Response envelopes (mirror backend/src/plugins/errorHandler.ts)
// ---------------------------------------------------------------------------

export interface ApiResponse<T> {
  data: T;
  meta?: ApiMeta;
}

export interface ApiMeta {
  limit?: number;
  offset?: number;
  total?: number;
  [key: string]: unknown;
}

export interface ApiErrorBody {
  status?: "error";
  error: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
  };
}

export class ApiClientError extends Error {
  public readonly code: string;
  public readonly details: Record<string, string[]> | undefined;
  public readonly status: number;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.name = "ApiClientError";
    this.code = body.error.code;
    this.details = body.error.details;
    this.status = status;
  }

  /** True when the backend rejected the payload with field-level errors. */
  get isValidationError(): boolean {
    return this.code === "VALIDATION_ERROR";
  }

  /**
   * Field-level messages flattened to one string per field, ready for
   * react-hook-form's `setError`. Root-level issues are keyed `_root`.
   */
  fieldErrors(): Record<string, string> {
    if (this.details === undefined) return {};

    const flattened: Record<string, string> = {};

    for (const [field, messages] of Object.entries(this.details)) {
      const first = messages[0];
      if (first !== undefined) flattened[field] = messages.join(". ");
      else flattened[field] = this.message;
    }

    return flattened;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { error?: unknown };
  if (typeof candidate.error !== "object" || candidate.error === null) return false;
  const inner = candidate.error as { code?: unknown; message?: unknown };
  return typeof inner.code === "string" && typeof inner.message === "string";
}

// ---------------------------------------------------------------------------
// Refresh coordination
// ---------------------------------------------------------------------------

/**
 * Shared across concurrent 401s: several parallel queries failing at once must
 * trigger exactly one refresh call, not one per request.
 */
let refreshInFlight: Promise<string | null> | null = null;

async function performRefresh(failedToken?: string | null): Promise<string | null> {
  // 1. Проверяем, не обновила ли уже другая вкладка access-токен пока мы ожидали:
  const currentToken = readAccessToken();
  if (
    currentToken &&
    failedToken &&
    currentToken !== failedToken &&
    getTokenRemainingSeconds(currentToken) > 60
  ) {
    return currentToken;
  }

  const refreshToken = readRefreshToken();

  try {
    const res = await fetch(buildUrl("/auth/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(refreshToken ? { refresh_token: refreshToken } : {}),
      credentials: "include",
    });

    if (!res.ok) {
      // 401 Unauthorized означает, что refresh token действительно недействителен/отозван.
      // Возвращаем null, чтобы вызывающий код инициировал завершение сессии.
      // При ошибках 429 (Rate Limit) или 5xx (сбой сервера) выбрасываем ApiClientError,
      // чтобы НЕ стирать токены пользователя из-за временного троттлинга или сбоя сети.
      if (res.status === 429 || res.status >= 500) {
        throw new ApiClientError(res.status, {
          error: {
            code: res.status === 429 ? "RATE_LIMIT_EXCEEDED" : "SERVER_ERROR",
            message:
              res.status === 429
                ? "Превышен лимит запросов, повторите попытку через несколько секунд"
                : "Сервис авторизации временно недоступен",
          },
        });
      }
      return null;
    }

    const body: unknown = await res.json();

    if (typeof body !== "object" || body === null) return null;
    const envelope = body as { data?: unknown };
    if (typeof envelope.data !== "object" || envelope.data === null) return null;

    const tokens = envelope.data as {
      access_token?: unknown;
      refresh_token?: unknown;
    };

    if (typeof tokens.access_token !== "string") {
      return null;
    }

    writeTokens({
      accessToken: tokens.access_token,
      refreshToken: typeof tokens.refresh_token === "string" ? tokens.refresh_token : "",
    });

    return tokens.access_token;
  } catch (err) {
    if (err instanceof ApiClientError && (err.status === 429 || err.status >= 500)) {
      throw err;
    }
    // Network failure during refresh — treat as "cannot refresh" rather than
    // throwing, so the caller falls through to the sign-out path.
    return null;
  }
}

export function refreshAccessToken(failedToken?: string | null): Promise<string | null> {
  const pending = refreshInFlight;
  if (pending !== null) return pending;

  // Межвкладочная координация: предотвращает шквал параллельных запросов /auth/refresh
  // при одновременном пробуждении нескольких вкладок
  if (typeof navigator !== "undefined" && navigator.locks) {
    const lockPromise: Promise<string | null> = navigator.locks
      .request("getvoxly_refresh_lock", async (): Promise<string | null> => {
        const currentToken = readAccessToken();
        if (
          currentToken &&
          failedToken &&
          currentToken !== failedToken &&
          getTokenRemainingSeconds(currentToken) > 60
        ) {
          return currentToken;
        }
        return await performRefresh(failedToken);
      })
      .then((res) => (typeof res === "string" ? res : null));

    refreshInFlight = lockPromise.finally(() => {
      refreshInFlight = null;
    });

    return lockPromise;
  }

  // Fallback для окружений без Web Locks API
  const started = performRefresh(failedToken);

  refreshInFlight = started.finally(() => {
    refreshInFlight = null;
  });

  return started;
}

/**
 * Endpoints whose own 401 is a final answer, not an expired access token.
 *
 * A 401 here must surface to the caller so the form can show "wrong password"
 * or "session expired", instead of being swallowed by a refresh attempt that
 * ends in a redirect.
 */
const CREDENTIAL_PATHS: ReadonlySet<string> = new Set([
  "/auth/login",
  "/auth/login/verify",
  "/auth/refresh",
  "/auth/logout",
  "/auth/otp/send",
  "/auth/otp/verify",
  "/auth/register",
  "/auth/code/request",
  "/auth/code/status",
  // Восстановление пароля выполняется без сессии: отказ здесь окончателен, и
  // попытка «обновить токен» увела бы пользователя на /login вместо показа
  // ошибки в форме.
  "/auth/forgot-password",
  "/auth/reset-password",
]);

function isCredentialPath(path: string): boolean {
  const [pathname] = path.split("?");
  return pathname !== undefined && CREDENTIAL_PATHS.has(pathname);
}

function redirectToLogin(): void {
  if (typeof window === "undefined") return;

  const target = `${window.location.pathname}${window.location.search}`;
  const loginUrl =
    target === "/login" || target.startsWith("/login?")
      ? "/login"
      : `/login?redirect=${encodeURIComponent(target)}`;

  window.location.href = loginUrl;
}

// ---------------------------------------------------------------------------
// Core request
// ---------------------------------------------------------------------------

interface RequestOptions {
  query?: QueryParams;
  /**
   * Suppresses the automatic refresh-and-retry on 401.
   *
   * Set internally on the replayed request to prevent an infinite loop, and
   * passed explicitly by the auth endpoints themselves: `/auth/refresh` must not
   * trigger another refresh, and `/auth/login` returning 401 is a wrong
   * password, not an expired session — retrying it would clear the session and
   * redirect, which is what made a failed login look like a silent reload.
   */
  retrying?: boolean;
  signal?: AbortSignal;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const token = readAccessToken();

  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const headers: Record<string, string> = {};
  if (body !== undefined && !isFormData) headers["Content-Type"] = "application/json";
  if (token !== null) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body: isFormData ? (body as FormData) : body === undefined ? undefined : JSON.stringify(body),
      // Allows the backend to move to httpOnly cookies (M0.6.5) without a
      // client change.
      credentials: "include",
      ...(options.signal !== undefined && { signal: options.signal }),
    });
  } catch (networkErr) {
    if (options.retrying !== true && (!options.signal || !options.signal.aborted)) {
      // Кратковременный сетевой сбой или перезапуск контейнера бэкенда: одна повторная попытка
      await new Promise((r) => setTimeout(r, 700));
      return request<T>(method, path, body, { ...options, retrying: true });
    }
    throw new ApiClientError(0, {
      error: {
        code: "NETWORK_ERROR",
        message: networkErr instanceof Error && networkErr.name === "AbortError"
          ? "Превышено время ожидания запроса"
          : "Служба временно недоступна, повторите попытку",
      },
    });
  }

  // При получении 502/503/504 (перезапуск бэкенда за прокси) — пробуем повторить запрос один раз
  if ((res.status === 502 || res.status === 503 || res.status === 504) && options.retrying !== true) {
    await new Promise((r) => setTimeout(r, 800));
    return request<T>(method, path, body, { ...options, retrying: true });
  }

  // Expired access token: refresh once, then replay the original request.
  //
  // Credential endpoints are excluded. A 401 from /auth/login means "wrong
  // password" and from /auth/refresh means "this session is over" — neither is
  // a stale access token. Treating them as one is what produced the reported
  // loop: a failed sign-in cleared the session and navigated to /login, so the
  // form appeared to reload silently with no error shown.
  if (res.status === 401 && options.retrying !== true && !isCredentialPath(path)) {
    let refreshed: string | null = null;
    try {
      refreshed = await refreshAccessToken(token);
    } catch (refreshErr) {
      // При временных ошибках (429 Rate Limit или 5xx Server Error)
      // НЕЛЬЗЯ сбрасывать сохранённую сессию и перенаправлять на /login!
      if (
        refreshErr instanceof ApiClientError &&
        (refreshErr.status === 429 || refreshErr.status >= 500)
      ) {
        throw refreshErr;
      }
      refreshed = null;
    }

    if (refreshed !== null) {
      return request<T>(method, path, body, { ...options, retrying: true });
    }

    clearSession();
    redirectToLogin();

    throw new ApiClientError(401, {
      error: { code: "UNAUTHORIZED", message: "Session expired. Please sign in again." },
    });
  }

  if (res.status === 204) {
    return { data: undefined as T };
  }

  if (!res.ok) {
    const parsed: unknown = await res.json().catch(() => null);

    throw new ApiClientError(
      res.status,
      isApiErrorBody(parsed)
        ? parsed
        : { error: { code: "UNKNOWN_ERROR", message: res.statusText || "Request failed" } },
    );
  }

  const parsed: unknown = await res.json().catch(() => null);

  if (typeof parsed !== "object" || parsed === null || !("data" in parsed)) {
    throw new ApiClientError(res.status, {
      error: { code: "MALFORMED_RESPONSE", message: "Unexpected response shape from API" },
    });
  }

  return parsed as ApiResponse<T>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const apiClient = {
  get<T>(path: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>("GET", path, undefined, options);
  },

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>("POST", path, body, options);
  },

  postFormData<T>(path: string, formData: FormData, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>("POST", path, formData, options);
  },

  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>("PUT", path, body, options);
  },

  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>("PATCH", path, body, options);
  },

  delete<T>(path: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>("DELETE", path, undefined, options);
  },
};
