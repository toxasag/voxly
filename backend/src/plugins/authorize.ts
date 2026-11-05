import type { FastifyPluginAsync, FastifyRequest, onRequestAsyncHookHandler } from "fastify";
import fp from "fastify-plugin";
import { AppError, NotFoundError, PermissionDeniedError, UnauthorizedError } from "./errorHandler.js";
import { setRequestCrossTenant } from "../db/client.js";
import { MODULE_SLUGS, type ModuleSlug, type Permission, type Role } from "../types/index.js";

function isModuleSlug(value: string): value is ModuleSlug {
  return (MODULE_SLUGS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Instance augmentation
// ---------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyInstance {
    /** Hook factory: 403 unless the caller holds `permission`. */
    requirePermission: (permission: Permission) => onRequestAsyncHookHandler;
    /** Hook factory: 403 unless `slug` is installed for the tenant. */
    requireModule: (slug: ModuleSlug) => onRequestAsyncHookHandler;
    /**
     * Hook factory: как `requireModule`, но слаг берётся из параметра маршрута.
     * Нужен группам вида `/channels/:channel`, где модуль определяется URL.
     */
    requireModuleFromParam: (paramName: string) => onRequestAsyncHookHandler;
    /** Hook factory: 403 unless `slug` is installed for the tenant. */
    requireRole: (roles: Role[]) => onRequestAsyncHookHandler;
    /**
     * Hook factory: 403 unless the caller holds the global platform role.
     * Тенантные роли (даже owner) не проходят: платформенная админка видна
     * только держателям users.platform_role.
     */
    requirePlatformOwner: () => onRequestAsyncHookHandler;
  }
}

// ---------------------------------------------------------------------------
// Module gate
// ---------------------------------------------------------------------------

/** Distinct from PERMISSION_DENIED so the client can prompt an install. */
export class ModuleNotInstalledError extends AppError {
  constructor(slug: string) {
    super(403, "MODULE_NOT_INSTALLED", `Module "${slug}" is not installed for this tenant`);
  }
}

// ---------------------------------------------------------------------------
// Role hierarchy — higher roles inherit the permissions of lower ones
// ---------------------------------------------------------------------------

const ROLE_HIERARCHY: Record<Role, Role[]> = {
  owner: ["owner", "admin", "partner", "manager", "technician", "viewer"],
  admin: ["admin", "partner", "manager", "technician", "viewer"],
  partner: ["partner", "manager", "technician", "viewer"],
  manager: ["manager", "technician", "viewer"],
  technician: ["technician", "viewer"],
  viewer: ["viewer"],
};

/** Guards against a hook running before the authenticate plugin populated the request. */
function assertAuthenticated(request: FastifyRequest): void {
  if (request.authUser === undefined) {
    throw new UnauthorizedError("Authentication required");
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Adds the authorization hook factories. The UI hides what a user cannot use;
 * these hooks are the actual enforcement point (see .cursorrules §5).
 *
 * Wrapped in fastify-plugin on purpose: the decorators must live on the root
 * instance so every route group can call `app.requirePermission(...)`. It is
 * registered once from app.ts. The decorators are pure factories — they add no
 * hooks by themselves, so hoisting them has no side effects on routing.
 */
export const authorizePlugin: FastifyPluginAsync = fp(
  async (fastify) => {
    fastify.decorate("requirePermission", (permission: Permission): onRequestAsyncHookHandler => {
      return async (request: FastifyRequest): Promise<void> => {
        assertAuthenticated(request);

        // tenant:admin is a superset of every tenant-scoped permission.
        if (request.permissions.has(permission) || request.permissions.has("tenant:admin")) {
          return;
        }

        throw new PermissionDeniedError(`Missing required permission: ${permission}`);
      };
    });

    fastify.decorate("requireModule", (slug: ModuleSlug): onRequestAsyncHookHandler => {
      return async (request: FastifyRequest): Promise<void> => {
        assertAuthenticated(request);

        if (!request.installed_modules.includes(slug)) {
          throw new ModuleNotInstalledError(slug);
        }
      };
    });

    /**
     * Гейт модуля по параметру маршрута.
     *
     * Пять каналов обслуживаются одной группой роутов `/channels/:channel`,
     * поэтому слаг известен только в момент запроса. Значение сверяется с
     * закрытым списком `MODULE_SLUGS` до обращения к установленным модулям:
     * иначе произвольная строка в URL превратилась бы в 403 «модуль не
     * установлен» вместо 404, скрывая опечатку в пути.
     */
    fastify.decorate("requireModuleFromParam", (paramName: string): onRequestAsyncHookHandler => {
      return async (request: FastifyRequest): Promise<void> => {
        assertAuthenticated(request);

        const params: unknown = request.params;
        const raw =
          typeof params === "object" && params !== null
            ? (params as Record<string, unknown>)[paramName]
            : undefined;

        if (typeof raw !== "string" || !isModuleSlug(raw)) {
          throw new NotFoundError("Неизвестный модуль");
        }

        if (!request.installed_modules.includes(raw)) {
          throw new ModuleNotInstalledError(raw);
        }
      };
    });

    fastify.decorate("requireRole", (roles: Role[]): onRequestAsyncHookHandler => {
      return async (request: FastifyRequest): Promise<void> => {
        assertAuthenticated(request);

        const effective = ROLE_HIERARCHY[request.authUser.role] ?? [];
        const allowed = roles.some((role) => effective.includes(role));

        if (!allowed) {
          throw new PermissionDeniedError(`Requires one of: ${roles.join(", ")}`);
        }
      };
    });

    fastify.decorate("requirePlatformOwner", (): onRequestAsyncHookHandler => {
      return async (request: FastifyRequest): Promise<void> => {
        assertAuthenticated(request);

        const isPlatformOwner = request.authUser.platform_role === "platform_owner";
        const isImpersonatedByPlatformOwner = Boolean(
          request.impersonator_id && request.impersonator_platform_role === "platform_owner",
        );

        if (!isPlatformOwner && !isImpersonatedByPlatformOwner) {
          throw new PermissionDeniedError("Platform owner role required");
        }

        // Platform routes aggregate across tenants, so the per-tenant RLS
        // scope bound by `authenticate` would otherwise reduce every count to
        // the admin's own tenant. Escalation happens only after the role check
        // above, so a tenant-level user can never reach it.
        setRequestCrossTenant();
      };
    });
  },
  { name: "authorize" },
);
