import type { FastifyReply, FastifyRequest } from "fastify";
import { query } from "../db/client.js";

export interface AuditErrorInfo {
  code: string;
  message: string;
}

const requestAuditErrors = new WeakMap<FastifyRequest, AuditErrorInfo>();

export function setRequestAuditError(request: FastifyRequest, info: AuditErrorInfo): void {
  requestAuditErrors.set(request, info);
}

export function getRequestAuditError(request: FastifyRequest): AuditErrorInfo | undefined {
  return requestAuditErrors.get(request);
}

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SENSITIVE_KEYS = new Set([
  "password",
  "new_password",
  "old_password",
  "password_hash",
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "api_key",
  "apikey",
  "bot_token",
  "webhook_secret",
  "authorization",
  "cookie",
  "elba_api_key",
  "kontur_api_key",
]);

const SKIP_PATH_PREFIXES = [
  "/health",
  "/widget.js",
  "/api/v1/public/",
  "/api/v1/tenant/audit-log/client-error",
  "/api/v1/auth/refresh",
  "/auth/refresh",
  "/api/auth/refresh",
  "/api/v1/analytics/pre-chat-telemetry",
];

function redactValue(val: unknown, depth = 0): unknown {
  if (depth > 3) return "[truncated]";
  if (val === null || val === undefined) return val;
  if (typeof val === "string") {
    return val.length > 300 ? `${val.slice(0, 300)}...` : val;
  }
  if (typeof val === "number" || typeof val === "boolean") return val;
  if (Array.isArray(val)) {
    const sliced = val.slice(0, 20).map((item) => redactValue(item, depth + 1));
    if (val.length > 20) sliced.push(`...(+${val.length - 20})`);
    return sliced;
  }
  if (typeof val === "object") {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(val as Record<string, unknown>).slice(0, 30);
    for (const [k, v] of entries) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactValue(v, depth + 1);
      }
    }
    return out;
  }
  return undefined;
}

function parseRouteAction(method: string, rawPath: string): {
  action: string;
  entityType: string;
  entityId: string | null;
} {
  const cleanPath = rawPath.split("?")[0] ?? rawPath;
  const segments = cleanPath
    .replace(/^\/api\/v1\//, "")
    .replace(/^\//, "")
    .split("/")
    .filter(Boolean);

  let entityId: string | null = null;
  const normalizedSegments: string[] = [];

  for (const seg of segments) {
    if (UUID_RE.test(seg)) {
      if (!entityId) entityId = seg;
    } else {
      normalizedSegments.push(seg.replace(/[^a-zA-Z0-9_-]/g, "_"));
    }
  }

  const baseSegments = normalizedSegments.slice(0, 3);
  const entityType = baseSegments.slice(0, 2).join(".") || "api";
  const verb =
    method === "POST"
      ? "create"
      : method === "PATCH" || method === "PUT"
        ? "update"
        : method === "DELETE"
          ? "delete"
          : method.toLowerCase();

  const lastSeg = baseSegments[baseSegments.length - 1] ?? "";
  const alreadyHasVerb =
    lastSeg.includes("delete") ||
    lastSeg.includes("update") ||
    lastSeg.includes("create") ||
    lastSeg.includes("export") ||
    lastSeg.includes("import") ||
    lastSeg === "pay" ||
    lastSeg === "intake";

  const actionBase = baseSegments.join(".") || "request";
  const action = alreadyHasVerb ? actionBase : `${actionBase}.${verb}`;

  return { action, entityType, entityId };
}

/**
 * Неблокирующее логирование действий пользователей и ошибок HTTP-запросов в `tenant_audit_log`.
 * Логируются все авторизованные мутации (POST/PUT/PATCH/DELETE) и все ошибки (statusCode >= 400).
 */
export function recordHttpUserAction(request: FastifyRequest, reply: FastifyReply): void {
  const method = request.method.toUpperCase();
  if (method === "OPTIONS" || method === "HEAD") return;

  const statusCode = reply.statusCode;
  const isMutation = MUTATION_METHODS.has(method);
  const isError = statusCode >= 400;
  if (!isMutation && !isError) return;

  const tenantId = request.tenant_id;
  if (!tenantId) return;

  const pathOnly = (request.url ?? "").split("?")[0] ?? "";
  if (SKIP_PATH_PREFIXES.some((prefix) => pathOnly.startsWith(prefix))) {
    return;
  }

  const actorUserId = request.authUser?.id ?? null;
  const { action, entityType, entityId } = parseRouteAction(method, pathOnly);
  const finalAction = isError ? `${action}.error` : action;
  const errInfo = getRequestAuditError(request);

  const details: Record<string, unknown> = {
    method,
    path: pathOnly,
    statusCode,
    durationMs: Math.round(reply.elapsedTime),
    requestId: request.id,
    ip: request.ip,
  };

  if (errInfo) {
    details.errorCode = errInfo.code;
    details.errorMessage = errInfo.message;
  }

  if (isMutation && request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    details.payload = redactValue(request.body);
  }

  void query(
    `INSERT INTO tenant_audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [tenantId, actorUserId, finalAction, entityType, entityId, JSON.stringify(details)],
  ).catch((err: unknown) => {
    request.log.warn({ err, action: finalAction }, "Failed to persist tenant_audit_log entry");
  });
}

export async function recordClientErrorAction(params: {
  tenantId: string;
  actorUserId: string | null;
  code: string;
  message: string;
  method?: string;
  url?: string;
  statusCode?: number;
  page?: string;
  ip?: string;
}): Promise<void> {
  const details: Record<string, unknown> = {
    source: "frontend",
    errorCode: params.code,
    errorMessage: params.message.slice(0, 500),
    method: params.method,
    url: params.url,
    statusCode: params.statusCode,
    page: params.page,
    ip: params.ip,
  };

  await query(
    `INSERT INTO tenant_audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, 'client.api_error', 'frontend', NULL, $3::jsonb)`,
    [params.tenantId, params.actorUserId, JSON.stringify(details)],
  );
}
