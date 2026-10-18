"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiClient, ApiClientError } from "@/lib/api/apiClient";
import { useTenantModules } from "@/lib/api/use-tenant-modules";
import { clearSession, readRefreshToken, writeTokens } from "@/lib/auth/session";
import { isModuleSlug } from "@/types";
import type {
  CurrentUser,
  InstalledModule,
  ModuleSlug,
  Permission,
  PlatformRole,
  Role,
  Tenant,
} from "@/types";

// ---------------------------------------------------------------------------
// Backend contract (docs/03_API_CONTRACTS/03_01_AUTH_API.md §4)
// ---------------------------------------------------------------------------

interface AuthTokensDTO {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: string;
  user: {
    id: string;
    name: string;
    email: string;
    phone: string;
    role: Role;
    platform_role: PlatformRole | null;
    permissions: Permission[];
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    status: string;
  };
}

interface OtpSendDTO {
  message: string;
  expires_in_minutes: number;
}

/** Ответ эндпоинтов восстановления пароля: только текст для пользователя. */
export interface MessageDTO {
  message: string;
}

// ---------------------------------------------------------------------------
// Installed modules
//
// The auth response does not carry this list. It is loaded from
// GET /api/v1/tenant/modules after the session is restored; this avoids the old
// ASSUMED_MODULES fallback that made every optional module look installed.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthState {
  user: CurrentUser | null;
  tenant: Tenant | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export type AuthChannel = "telegram" | "max";

export interface RegisterInput {
  slug: string;
  email: string;
  phone: string;
  password: string;
  session_id: string;
  code: string;
}

/** Ответ на запрос кода: либо код уже в чате, либо нужна привязка бота. */
export interface RequestCodeResult {
  session_id: string;
  channel: AuthChannel;
  delivered: boolean;
  /** Ссылка на бота, когда чат ещё не привязан. */
  deep_link: string | null;
  bot_username: string;
  expires_in_minutes: number;
}

export interface CodeStatus {
  delivered: boolean;
  verified: boolean;
  expired: boolean;
}

/**
 * Returned by the sign-in calls so the caller can redirect to the tenant's own
 * subdomain. Read from the response rather than from context state, because
 * `setState` has not flushed by the time the handler navigates.
 */
export interface SignedInSession {
  slug: string;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<SignedInSession>;
  sendOtp: (phone: string) => Promise<OtpSendDTO>;
  loginWithOtp: (phone: string, code: string) => Promise<SignedInSession>;
  /** Creates the tenant + owner and signs in; resolves with the new slug. */
  register: (input: RegisterInput) => Promise<SignedInSession>;
  /** Requests a confirmation code through the Telegram bot. */
  requestCode: (input: {
    purpose: "register" | "login";
    channel: AuthChannel;
    phone: string;
    email?: string;
  }) => Promise<RequestCodeResult>;
  /** Polls delivery state: the code arrives once the user presses Start. */
  codeStatus: (sessionId: string) => Promise<CodeStatus>;
  /** Password + code sign-in (second factor). */
  loginWithCode: (input: {
    email: string;
    password: string;
    session_id: string;
    code: string;
  }) => Promise<SignedInSession>;
  /** Sends a password reset link. Resolves the same way for unknown addresses. */
  forgotPassword: (email: string) => Promise<MessageDTO>;
  /** Sets a new password using the token from the e-mail link. */
  resetPassword: (input: { token: string; password: string }) => Promise<MessageDTO>;
  logout: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function toCurrentUser(dto: AuthTokensDTO["user"]): CurrentUser {
  return {
    id: dto.id,
    email: dto.email,
    phone: dto.phone,
    name: dto.name,
    role: dto.role,
    platform_role: dto.platform_role ?? null,
    permissions: new Set<Permission>(dto.permissions),
  };
}

function toTenant(dto: AuthTokensDTO["tenant"]): Tenant {
  return {
    tenantId: dto.id,
    tenantName: dto.name,
    // Older tokens predate the slug column; an empty string keeps the UI
    // rendering instead of crashing on a missing field.
    slug: dto.slug ?? "",
    plan: dto.plan,
    // Filled reactively from GET /api/v1/tenant/modules in AuthProvider.
    installedModules: [],
  };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    tenant: null,
    isAuthenticated: false,
    isLoading: true,
  });

  const { data: liveModules } = useTenantModules(state.tenant?.tenantId ?? null);

  // В контекст попадают модули, у которых есть раздел интерфейса, — теперь
  // включая каналы: у них появились страницы `/integrations/*`, и без этого
  // фильтра `<Guard requiredModule="telegram">` всегда показывал бы «Модуль
  // отключён». `core_crm` отбрасывается: его разделы видны всегда.
  //
  // Проверка идёт через `isModuleSlug`, а не перечислением слагов: список жил
  // здесь копией, и каналы, добавленные в каталог, в него не попали.
  const currentTenantId = state.tenant?.tenantId;
  useEffect(() => {
    if (!currentTenantId || liveModules === undefined) return;

    const installedModules: InstalledModule[] = liveModules
      .filter((module): module is typeof module & { slug: ModuleSlug } =>
        isModuleSlug(module.slug),
      )
      .map((module) => ({
        slug: module.slug,
        name: module.name,
        installed_at: module.installedAt,
      }));

    setState((previous) => {
      if (previous.tenant === null) return previous;

      const same =
        previous.tenant.installedModules.length === installedModules.length &&
        previous.tenant.installedModules.every(
          (item, index) => item.slug === installedModules[index]?.slug,
        );

      if (same) return previous;

      return {
        ...previous,
        tenant: { ...previous.tenant, installedModules },
      };
    });
  }, [liveModules, currentTenantId]);

  const applySession = useCallback((dto: AuthTokensDTO) => {
    writeTokens({ accessToken: dto.access_token, refreshToken: dto.refresh_token });

    setState({
      user: toCurrentUser(dto.user),
      tenant: toTenant(dto.tenant),
      isAuthenticated: true,
      isLoading: false,
    });
  }, []);

  const resetSession = useCallback(() => {
    clearSession();
    setState({ user: null, tenant: null, isAuthenticated: false, isLoading: false });
  }, []);

  /**
   * Restores the session on mount by exchanging the stored refresh token.
   * This validates the session server-side and returns the current profile, so
   * revoked access and changed permissions take effect on reload.
   *
   * The refresh token is read once, into a local, rather than twice via
   * `readRefreshToken()`. The previous version read it again when building the
   * request body, so a concurrent `clearSession()` between the two reads sent
   * `refresh_token: null` and turned a recoverable session into a hard sign-out.
   */
  useEffect(() => {
    let cancelled = false;

    const restore = async (): Promise<void> => {
      const refreshToken = readRefreshToken();

      if (refreshToken === null) {
        if (!cancelled) setState((prev) => ({ ...prev, isLoading: false }));
        return;
      }

      try {
        const res = await apiClient.post<AuthTokensDTO>(
          "/auth/refresh",
          { refresh_token: refreshToken },
          // `retrying` suppresses apiClient's own refresh-and-retry: this *is*
          // the refresh call, and letting it recurse produced two /auth/refresh
          // requests for one page load, the second replaying a token the first
          // had already rotated.
          { retrying: true },
        );
        if (!cancelled) applySession(res.data);
      } catch {
        // Expired, revoked or unreachable — drop to signed-out rather than
        // leaving the UI stuck on a loading state.
        if (!cancelled) resetSession();
      }
    };

    void restore();

    return () => {
      cancelled = true;
    };
  }, [applySession, resetSession]);

  const login = useCallback(
    async (email: string, password: string): Promise<SignedInSession> => {
      // `retrying: true` keeps apiClient from treating a 401 here as an expired
      // session: a wrong password must surface as an error, not as a silent
      // session reset plus redirect back to /login.
      const res = await apiClient.post<AuthTokensDTO>(
        "/auth/login",
        { email, password },
        { retrying: true },
      );
      applySession(res.data);
      return { slug: res.data.tenant.slug ?? "" };
    },
    [applySession],
  );

  const sendOtp = useCallback(async (phone: string): Promise<OtpSendDTO> => {
    const res = await apiClient.post<OtpSendDTO>("/auth/otp/send", { phone });
    return res.data;
  }, []);

  const loginWithOtp = useCallback(
    async (phone: string, code: string): Promise<SignedInSession> => {
      const res = await apiClient.post<AuthTokensDTO>(
        "/auth/otp/verify",
        { phone, code },
        { retrying: true },
      );
      applySession(res.data);
      return { slug: res.data.tenant.slug ?? "" };
    },
    [applySession],
  );

  const register = useCallback(
    async (input: RegisterInput): Promise<SignedInSession> => {
      const res = await apiClient.post<AuthTokensDTO>("/auth/register", input, {
        retrying: true,
      });
      applySession(res.data);
      return { slug: res.data.tenant.slug ?? "" };
    },
    [applySession],
  );

  const requestCode = useCallback(
    async (input: {
      purpose: "register" | "login";
      channel: AuthChannel;
      phone: string;
      email?: string;
    }): Promise<RequestCodeResult> => {
      const res = await apiClient.post<RequestCodeResult>("/auth/code/request", input, {
        retrying: true,
      });
      return res.data;
    },
    [],
  );

  const codeStatus = useCallback(async (sessionId: string): Promise<CodeStatus> => {
    const res = await apiClient.get<CodeStatus>("/auth/code/status", {
      query: { session_id: sessionId },
      retrying: true,
    });
    return res.data;
  }, []);

  const loginWithCode = useCallback(
    async (input: {
      email: string;
      password: string;
      session_id: string;
      code: string;
    }): Promise<SignedInSession> => {
      const res = await apiClient.post<AuthTokensDTO>("/auth/login/verify", input, {
        retrying: true,
      });
      applySession(res.data);
      return { slug: res.data.tenant.slug ?? "" };
    },
    [applySession],
  );

  /**
   * `retrying: true` на обоих вызовах: 401/400 здесь — окончательный ответ, а не
   * истёкший access-токен. Без этого неудачный сброс сбрасывал бы сессию и
   * уводил на /login вместо показа ошибки в форме.
   */
  const forgotPassword = useCallback(async (email: string): Promise<MessageDTO> => {
    const res = await apiClient.post<MessageDTO>(
      "/auth/forgot-password",
      { email },
      { retrying: true },
    );
    return res.data;
  }, []);

  const resetPassword = useCallback(
    async (input: { token: string; password: string }): Promise<MessageDTO> => {
      const res = await apiClient.post<MessageDTO>("/auth/reset-password", input, {
        retrying: true,
      });
      return res.data;
    },
    [],
  );

  const logout = useCallback(async () => {
    const refreshToken = readRefreshToken();

    if (refreshToken !== null) {
      try {
        await apiClient.post("/auth/logout", { refresh_token: refreshToken });
      } catch {
        // Server-side revocation failed; the local session is cleared either
        // way so the user is not left appearing signed in.
      }
    }

    resetSession();
  }, [resetSession]);

  /**
   * Tenant switching needs a backend endpoint that mints a token for another
   * tenant; none exists. Kept on the interface so callers compile, but it
   * fails loudly instead of pretending to work.
   */
  const switchTenant = useCallback(async (tenantId: string) => {
    void tenantId;
    throw new ApiClientError(501, {
      error: {
        code: "NOT_IMPLEMENTED",
        message: "Tenant switching requires a backend endpoint (not yet available)",
      },
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      sendOtp,
      loginWithOtp,
      register,
      requestCode,
      codeStatus,
      loginWithCode,
      forgotPassword,
      resetPassword,
      logout,
      switchTenant,
    }),
    [
      state,
      login,
      sendOtp,
      loginWithOtp,
      register,
      requestCode,
      codeStatus,
      loginWithCode,
      forgotPassword,
      resetPassword,
      logout,
      switchTenant,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

export function useCurrentUser(): CurrentUser | null {
  return useAuth().user;
}

export function useRole(): Role | null {
  return useAuth().user?.role ?? null;
}

export function useIsAuthenticated(): boolean {
  return useAuth().isAuthenticated;
}

export function usePermissions(): Set<Permission> {
  return useAuth().user?.permissions ?? new Set<Permission>();
}

export function useHasPermission(permission: Permission): boolean {
  const permissions = usePermissions();
  // tenant:admin is a superset server-side (authorize.ts); mirrored here so the
  // UI hides exactly what the API would reject.
  return permissions.has(permission) || permissions.has("tenant:admin");
}

export function useIsModuleInstalled(slug: ModuleSlug): boolean {
  const { tenant } = useAuth();
  return tenant?.installedModules.some((module) => module.slug === slug) ?? false;
}
