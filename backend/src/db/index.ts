// Re-export the pool helpers so existing `../../../db/index.js` imports keep
// working. New code should import from "./db/client.js" directly.
export {
  checkConnection,
  closePool,
  getPool,
  query,
  queryOne,
  queryOneOrThrow,
  transaction,
  withTenant,
  type SqlParam,
  type TransactionClient,
} from "./client.js";
