import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";

// ---------------------------------------------------------------------------
// PostgreSQL connection pool.
//
// Every tenant-scoped query MUST filter on tenant_id (see .cursorrules §4).
// The `app.tenant_id` GUC backs the RLS policies in db/schema.sql as a second
// line of defence: if a WHERE clause is ever forgotten, RLS blocks
// cross-tenant rows rather than leaking them.
//
// The GUC is applied automatically, not per call site. `runWithTenantContext`
// (invoked by the authenticate hook) stores the tenant id in AsyncLocalStorage,
// and every pooled query/transaction below sets the GUC on the connection it
// checked out before running the caller's SQL. Requiring each of the ~40
// existing `query()` call sites to opt in would have meant that any missed one
// silently returned zero rows once RLS became enforced — a far worse failure
// mode than a redundant `set_config`.
//
// Pooled connections are reused across requests, so the GUC must be set per
// checkout: a stale value left by a previous tenant's request would otherwise
// be read by the next one.
// ---------------------------------------------------------------------------

/** Values accepted as SQL bind parameters. */
export type SqlParam = string | number | boolean | Date | null | string[] | number[];

const DEFAULT_MAX_CLIENTS = 10;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;

function readPoolConfig(): PoolConfig {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error(
      "DATABASE_URL is not set. Export it in the environment before starting the server.",
    );
  }

  return {
    connectionString,
    max: Number(process.env.PGPOOL_MAX ?? DEFAULT_MAX_CLIENTS),
    idleTimeoutMillis: Number(process.env.PGPOOL_IDLE_TIMEOUT_MS ?? DEFAULT_IDLE_TIMEOUT_MS),
    connectionTimeoutMillis: Number(
      process.env.PGPOOL_CONNECT_TIMEOUT_MS ?? DEFAULT_CONNECTION_TIMEOUT_MS,
    ),
    // NUMERIC columns arrive as strings from pg; DTO mappers convert them
    // explicitly with Number() so precision handling stays visible.
    application_name: process.env.PGAPPNAME ?? "getvoxly-api",
  };
}

// ---------------------------------------------------------------------------
// Ambient tenant context
// ---------------------------------------------------------------------------

/**
 * Mutable on purpose.
 *
 * The context is established at the very start of the request, before the
 * tenant is known (authentication needs a DB lookup first). The authenticate
 * hook then fills in the tenant by mutating this same object, which every
 * later query observes because they all share the reference.
 *
 * `enterWith()` was tried first and does not work here: it mutates the current
 * async context frame, but each `await` resumes on the frame captured when the
 * continuation was scheduled, so the value was silently lost before any query
 * ran — RLS then rejected every insert and reported zero installed modules.
 */
interface TenantContextHolder {
  /** Tenant whose rows this request may touch; null before authentication. */
  tenantId: string | null;
  /**
   * Platform-level request (superadmin metrics/tenant list) that must read
   * across tenants. Set only by routes already gated on `platform_owner`.
   */
  crossTenant: boolean;
}

const tenantStore = new AsyncLocalStorage<TenantContextHolder>();

/**
 * Establishes an empty context for one request and continues the chain inside
 * it.
 *
 * Callback style (`next`) rather than async: Fastify's hook runner invokes the
 * continuation synchronously inside this callback, so every later hook, the
 * route handler and all queries inherit the context. Inherited context — unlike
 * `enterWith` — survives `await`.
 */
export function runWithRequestContext(next: () => void): void {
  tenantStore.run({ tenantId: null, crossTenant: false }, next);
}

/**
 * Binds the authenticated tenant to the in-flight request.
 *
 * No-op outside a request context so background callers are unaffected.
 */
export function setRequestTenant(tenantId: string): void {
  const holder = tenantStore.getStore();
  if (holder === undefined) return;

  holder.tenantId = tenantId;
  holder.crossTenant = false;
}

/**
 * Escalates the in-flight request to platform scope, for superadmin routes that
 * legitimately aggregate across tenants.
 *
 * Only called from handlers already gated on `platform_role = 'platform_owner'`
 * (see plugins/authorize.ts). The tenant id is cleared so a stale value cannot
 * narrow a platform-wide query.
 */
export function setRequestCrossTenant(): void {
  const holder = tenantStore.getStore();
  if (holder === undefined) return;

  holder.tenantId = null;
  holder.crossTenant = true;
}

/**
 * Runs `handler` with an ambient tenant context. Used where a callback
 * boundary already exists (background work, seeding, tests).
 */
export function runWithTenantContext<T>(tenantId: string, handler: () => Promise<T>): Promise<T> {
  return tenantStore.run({ tenantId, crossTenant: false }, handler);
}

/**
 * Runs `handler` with platform scope: reads see every tenant's rows.
 *
 * For background workers that legitimately serve all tenants at once — the
 * Telegram transport, which must list connected accounts across the whole
 * platform before it knows which tenant each belongs to.
 *
 * Without it such a worker sees nothing: `channel_accounts` is under RLS, and
 * outside a tenant context `current_tenant_id()` is NULL, so the policy matches
 * no rows. Verified directly against the database — a plain `SELECT` under
 * `app_user` with an empty GUC returned zero rows for an existing connected
 * account.
 *
 * Deliberately read-only in intent: the policy's `WITH CHECK` has no
 * `platform_scope()`, so writes still require the owning tenant's context. Any
 * mutation must therefore run inside `runWithTenantContext(tenantId, ...)`.
 */
export function runWithPlatformScope<T>(handler: () => Promise<T>): Promise<T> {
  return tenantStore.run({ tenantId: null, crossTenant: true }, handler);
}

/** Current ambient context, or null outside any request. */
export function currentTenantContext(): TenantContextHolder | null {
  return tenantStore.getStore() ?? null;
}

/**
 * Applies the ambient context to a freshly checked-out connection.
 *
 * `set_config(..., false)` makes both settings session-scoped rather than
 * transaction-scoped, because plain `query()` calls run outside any explicit
 * transaction and a transaction-local value would be discarded before the
 * caller's SQL ran. Both are always written, never conditionally skipped: a
 * pooled connection may carry a previous request's value, and leaving it in
 * place would scope this query to the wrong tenant.
 */
async function applyTenantGuc(client: PoolClient | Pool): Promise<void> {
  const context = tenantStore.getStore();
  if (context === undefined) return;

  await client.query(
    "SELECT set_config('app.tenant_id', $1, false), set_config('app.platform_scope', $2, false)",
    [context.tenantId ?? "", context.crossTenant ? "on" : "off"],
  );
}

let poolInstance: Pool | null = null;

/**
 * Lazily creates the shared pool. Deferring construction keeps `tsc` and unit
 * tests importable without a live DATABASE_URL.
 */
export function getPool(): Pool {
  if (poolInstance === null) {
    poolInstance = new Pool(readPoolConfig());

    poolInstance.on("error", (error: Error) => {
      // An idle client failed. pg removes it from the pool automatically; log
      // and keep serving rather than crashing the process.
      console.error("[db] idle client error", error.message);
    });
  }

  return poolInstance;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * Runs a parameterised query and returns typed rows.
 *
 * Inside a request context the connection is checked out explicitly so the
 * tenant GUC can be set on that same connection before the caller's SQL runs.
 * Outside one (startup, /health, the pre-login auth lookups) it falls through
 * to the pool directly — those paths read tables that are not under RLS.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly SqlParam[] = [],
): Promise<T[]> {
  const pool = getPool();

  if (tenantStore.getStore() === undefined) {
    const result: QueryResult<T> = await pool.query<T>(sql, params as SqlParam[]);
    return result.rows;
  }

  const client = await pool.connect();

  try {
    await applyTenantGuc(client);
    const result: QueryResult<T> = await client.query<T>(sql, params as SqlParam[]);
    return result.rows;
  } finally {
    // RESET keeps the settings from leaking to the next request that reuses
    // this pooled connection; a failure here must not mask the original error.
    try {
      await client.query("RESET app.tenant_id; RESET app.platform_scope");
    } catch {
      /* connection is being discarded anyway */
    }
    client.release();
  }
}

/** Returns the first row, or null when the query matched nothing. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly SqlParam[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * Returns the first row or throws. Use only where the SQL guarantees a row
 * (e.g. `INSERT ... RETURNING`), so a missing row is a genuine invariant break.
 */
export async function queryOneOrThrow<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly SqlParam[] = [],
): Promise<T> {
  const row = await queryOne<T>(sql, params);

  if (row === null) {
    throw new Error("Expected exactly one row but the query returned none");
  }

  return row;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/** Query surface handed to transaction callbacks. */
export interface TransactionClient {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly SqlParam[],
  ): Promise<T[]>;
  queryOne<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly SqlParam[],
  ): Promise<T | null>;
  queryOneOrThrow<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly SqlParam[],
  ): Promise<T>;
}

function wrapClient(client: PoolClient): TransactionClient {
  const run = async <T extends QueryResultRow>(
    sql: string,
    params: readonly SqlParam[] = [],
  ): Promise<T[]> => {
    const result: QueryResult<T> = await client.query<T>(sql, params as SqlParam[]);
    return result.rows;
  };

  return {
    query: run,
    queryOne: async <T extends QueryResultRow>(sql: string, params: readonly SqlParam[] = []) => {
      const rows = await run<T>(sql, params);
      return rows[0] ?? null;
    },
    queryOneOrThrow: async <T extends QueryResultRow>(
      sql: string,
      params: readonly SqlParam[] = [],
    ) => {
      const rows = await run<T>(sql, params);
      const row = rows[0];

      if (row === undefined) {
        throw new Error("Expected exactly one row but the query returned none");
      }

      return row;
    },
  };
}

/**
 * Runs `handler` inside a single transaction. Commits on resolve, rolls back
 * on throw, and always returns the client to the pool.
 */
export async function transaction<T>(
  handler: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    // Applied inside the transaction so RLS sees the tenant for every
    // statement, including those issued by callers that never used withTenant.
    await applyTenantGuc(client);
    const result = await handler(wrapClient(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      // Surface the rollback failure but keep the original error as the cause.
      console.error("[db] rollback failed", rollbackError);
    }
    throw error;
  } finally {
    try {
      await client.query("RESET app.tenant_id; RESET app.platform_scope");
    } catch {
      /* connection is being discarded anyway */
    }
    client.release();
  }
}

/**
 * Runs `handler` in a transaction with `app.tenant_id` set for the duration,
 * which is what the RLS policies in schema.sql read. Queries inside must still
 * carry their own `WHERE tenant_id = $1`; this is defence in depth, not a
 * replacement.
 */
export async function withTenant<T>(
  tenantId: string,
  handler: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  // The explicit tenantId wins over any ambient context: callers pass it from
  // the verified token, and it must also hold when no ambient context exists
  // (background jobs, seeding).
  return tenantStore.run({ tenantId, crossTenant: false }, () =>
    transaction(async (tx) => {
      // set_config is parameterised — the tenant id is never interpolated.
      await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      return handler(tx);
    }),
  );
}

/** Closes the pool. Called from the server's shutdown hook. */
export async function closePool(): Promise<void> {
  if (poolInstance !== null) {
    await poolInstance.end();
    poolInstance = null;
  }
}

/** Lightweight readiness probe used by GET /health. */
export async function checkConnection(): Promise<boolean> {
  try {
    await query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
