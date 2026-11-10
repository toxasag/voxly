import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { UnauthorizedError } from "./errorHandler.js";
import { query, queryOne, setRequestTenant } from "../db/client.js";
import { toPermissions } from "../config/permissions.js";
import type { Permission, PlatformRole, Role, User } from "../types/index.js";

// ---------------------------------------------------------------------------
// Request augmentation
// ---------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyRequest {
    authUser: User;
    tenant_id: string;
    tenant_is_partner?: boolean;
    permissions: Set<Permission>;
    installed_modules: string[];
    impersonator_id?: string;
    impersonator_tenant_id?: string;
    impersonator_platform_role?: PlatformRole | null;
    impersonator_is_partner?: boolean;
  }
}

interface JwtPayload {
  sub: string;
  tenant_id: string;
  /** Absent on legacy tokens; `refresh` tokens are rejected on the API. */
  typ?: string;
  impersonator_id?: string;
}

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  /** NULL у приглашённого сотрудника: телефон задаётся при активации. */
  phone: string | null;
  name: string;
  role: Role;
  platform_role: PlatformRole | null;
  permissions: string[] | null;
  is_partner?: boolean;
  tenant_is_partner?: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ModuleRow {
  slug: string;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function isJwtPayload(value: unknown): value is JwtPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;

  if (typeof candidate.sub !== "string" || typeof candidate.tenant_id !== "string") return false;

  return candidate.typ === undefined || typeof candidate.typ === "string";
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/**
 * Loads the user by id *and* tenant. Scoping on tenant_id means a token minted
 * for one tenant can never resolve a user in another, even if the id is valid.
 */
/** Валидные глобальные роли; всё прочее в БД трактуется как «нет роли». */
const VALID_PLATFORM_ROLES: ReadonlySet<string> = new Set<PlatformRole>(["platform_owner"]);

function toPlatformRole(raw: string | null): PlatformRole | null {
  if (raw === null) return null;
  return VALID_PLATFORM_ROLES.has(raw) ? (raw as PlatformRole) : null;
}

async function resolveUser(userId: string, tenantId: string): Promise<User | null> {
  // `deleted_at IS NULL` обязателен: access-токен живёт 15 минут, и без этого
  // условия уволенный сотрудник продолжал бы работать до его истечения, а
  // выданный ранее refresh-токен восстанавливал бы сессию и после.
  const rows = await query<UserRow>(
    `SELECT u.id, u.tenant_id, u.email, u.phone, u.name, u.role, u.platform_role, u.permissions,
            u.is_partner, t.is_partner AS tenant_is_partner, u.created_at, u.updated_at
     FROM users u
     JOIN tenants t ON t.id = u.tenant_id
     WHERE u.id = $1 AND u.tenant_id = $2 AND u.deleted_at IS NULL`,
    [userId, tenantId],
  );

  const row = rows[0];
  if (row === undefined) return null;

  return {
    id: row.id,
    tenant_id: row.tenant_id,
    email: row.email,
    phone: row.phone ?? "",
    name: row.name,
    role: row.role,
    platform_role: toPlatformRole(row.platform_role),
    permissions: toPermissions(row.permissions),
    is_partner: Boolean(row.is_partner || row.role === "partner"),
    tenant_is_partner: Boolean(row.tenant_is_partner),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

/**
 * Reads the tenant's module list.
 *
 * `installed_modules` is under RLS, and the API now connects as a restricted
 * role, so this must run with the tenant context already bound — hence the
 * `enterTenantContext` call before it in the hook. Without that ordering the
 * query would return no rows, every module would look uninstalled, and each
 * module-gated route would 403.
 */
async function resolveInstalledModules(tenantId: string): Promise<string[]> {
  const rows = await query<ModuleRow>(
    `SELECT slug FROM installed_modules WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows.map((row) => row.slug);
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  "/auth/otp/send",
  "/auth/otp/verify",
  "/auth/login",
  "/auth/refresh",
  "/auth/logout",
  "/auth/exit-impersonation",
  "/auth/revert-impersonation",
  "/api/v1/auth/exit-impersonation",
  "/api/v1/auth/revert-impersonation",
  "/api/auth/exit-impersonation",
  "/api/auth/revert-impersonation",
  "/api/v1/admin/tenants/exit-impersonation",
  // Self-service signup: the caller has no tenant yet, by definition.
  "/auth/register",
  "/auth/slug-available",
  // Code delivery and the bot webhooks run before any session exists.
  "/auth/code/request",
  "/auth/code/status",
  "/auth/login/verify",
  "/auth/telegram/webhook",
  "/auth/max/webhook",
  // Password recovery: by definition the caller cannot authenticate.
  "/auth/forgot-password",
  "/auth/reset-password",
  // Accepting a team invite: the account exists but is not active yet, so the
  // invitee has no credentials to authenticate with.
  "/auth/invite",
  "/auth/invite/accept",
  "/health",
  "/api/ai-bots/generate-prompt",
  "/api/v1/ai-bots/generate-prompt",
  "/api/ai/generate-prompt",
  "/api/v1/ai/generate-prompt",
  "/api/bots/generate-prompt",
  "/api/v1/bots/generate-prompt",
]);

/**
 * Verifies the bearer token and attaches `authUser`, `tenant_id`,
 * `permissions` and `installed_modules` to the request.
 *
 * Wrapped in fastify-plugin so the hook lands on the *parent* context — the
 * route group that registers it. Without the wrapper, `addHook` binds to this
 * plugin's own (routeless) encapsulation context and therefore never runs for
 * any route at all, which silently left every protected endpoint failing in
 * `authorize`'s `assertAuthenticated` with a misleading 401.
 *
 * Scoping still holds: each protected group registers it explicitly, so the
 * hook does not leak into the public `/auth/*` routes or `/health`.
 */
export const authenticatePlugin: FastifyPluginAsync = fp(
  async (fastify) => {
    fastify.addHook("onRequest", async (request: FastifyRequest) => {
      const path = (request.url ?? "").split("?")[0] ?? "";

      // Defence in depth: the hook is only registered on protected groups, but
      // a future misplacement must not start demanding tokens on /auth.
      if (
        PUBLIC_PATHS.has(path) ||
        path.includes("/widgets/bootstrap/") ||
        path.endsWith("/events") ||
        path.includes("/events/")
      ) {
        return;
      }

      let token: string | undefined;
      const authHeader = request.headers.authorization;

      if (authHeader !== undefined && authHeader.startsWith("Bearer ")) {
        token = authHeader.slice("Bearer ".length);
      } else if (request.headers.cookie) {
        const cookieMatch = request.headers.cookie.match(/(?:^|;\s*)(?:getvoxly_auth_token|access_token)=([^;]+)/);
        if (cookieMatch && cookieMatch[1]) token = decodeURIComponent(cookieMatch[1]);
      }

      if (!token && typeof (request.query as Record<string, unknown> | undefined)?.token === "string") {
        token = (request.query as Record<string, string>).token;
      }

      if (!token) {
        throw new UnauthorizedError("Missing bearer token");
      }
      let payload: unknown;

      try {
        payload = fastify.jwt.verify(token);
      } catch {
        throw new UnauthorizedError("Invalid or expired token");
      }

      if (!isJwtPayload(payload)) {
        throw new UnauthorizedError("Invalid token payload");
      }

      // Access tokens only: a refresh token must never unlock the API.
      if (payload.typ !== undefined && payload.typ !== "access") {
        throw new UnauthorizedError("Invalid token type");
      }

      // DB failures must surface as 500, not as a misleading 401 — hence the
      // lookups sit outside the try/catch above.
      const user = await resolveUser(payload.sub, payload.tenant_id);

      if (user === null) {
        throw new UnauthorizedError("User not found");
      }

      request.authUser = user;
      request.tenant_id = user.tenant_id;
      request.tenant_is_partner = user.tenant_is_partner;
      request.permissions = new Set<Permission>(user.permissions);

      if (typeof payload.impersonator_id === "string") {
        const impersonator = await queryOne<{
          id: string;
          tenant_id: string;
          platform_role: PlatformRole | null;
          is_partner: boolean;
          role: Role;
          tenant_is_partner: boolean;
        }>(
          `SELECT u.id, u.tenant_id, u.platform_role, u.is_partner, u.role, t.is_partner AS tenant_is_partner
           FROM users u
           JOIN tenants t ON t.id = u.tenant_id
           WHERE u.id = $1 AND u.deleted_at IS NULL`,
          [payload.impersonator_id],
        );
        if (impersonator) {
          request.impersonator_id = impersonator.id;
          request.impersonator_tenant_id = impersonator.tenant_id;
          request.impersonator_platform_role = impersonator.platform_role;
          request.impersonator_is_partner = Boolean(
            impersonator.is_partner || impersonator.role === "partner" || impersonator.tenant_is_partner,
          );
        }
      }

      // Binds the tenant for every subsequent DB call in this request, so the
      // RLS policies apply without each service having to opt in. Set from the
      // resolved user rather than the raw token claim: resolveUser already
      // scoped the lookup to the token's tenant, so this cannot be spoofed.
      setRequestTenant(user.tenant_id);

      request.installed_modules = await resolveInstalledModules(user.tenant_id);
    });
  },
  { name: "authenticate" },
);
