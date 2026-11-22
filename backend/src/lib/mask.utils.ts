// ---------------------------------------------------------------------------
// Единые утилиты маскирования PII и секретов для безопасного логирования и UI.
// ---------------------------------------------------------------------------

/** Маскирование номера телефона: `+79991234567` → `+79***67`. */
export function maskPhone(phone: string): string {
  const clean = phone.replace(/\s+/g, "");
  return clean.length <= 5 ? "***" : `${clean.slice(0, 3)}***${clean.slice(-2)}`;
}

/** Маскирование e-mail: `ivan@example.com` → `i***n@example.com`. */
export function maskEmail(email: string): string {
  const parts = email.split("@");
  if (parts.length !== 2) return "***";
  const [local, domain] = parts;
  if (!local || !domain) return "***";
  const maskedLocal =
    local.length <= 2 ? `${local[0]}***` : `${local[0]}***${local[local.length - 1]}`;
  return `${maskedLocal}@${domain}`;
}

/** Маскирование токена для логов: `abcdef123456` → `abcd...456`. */
export function maskToken(token: string): string {
  if (token.length <= 6) return "***";
  return `${token.slice(0, 4)}...${token.slice(-3)}`;
}

/**
 * Маскирование API-ключа (LLM / интеграции).
 * По умолчанию сохраняет 4 символа префикса и 4 суффикса (`AIza••••1234`).
 */
export function maskApiKey(key: string, prefixLen = 4): string {
  const trimmed = key.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, prefixLen)}••••${trimmed.slice(-4)}`;
}
