import { createHash } from "node:crypto";

/**
 * SHA-256 хеш одноразовых/сессионных токенов перед записью или поиском в БД.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
