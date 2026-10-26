import { createHash } from "node:crypto";

/**
 * Нормализация и SHA-256 хэширование email согласно стандартам GA4 / Meta CAPI / VK.
 * Требование: нижний регистр, удаление пробелов, sha256 в hex.
 */
export function hashEmail(email?: string | null): string | null {
  if (!email) return null;
  const clean = email.trim().toLowerCase();
  if (!clean.includes("@") || clean.length < 5) return null;
  return createHash("sha256").update(clean).digest("hex");
}

/**
 * Нормализация и SHA-256 хэширование телефона согласно стандартам GA4 / Meta CAPI / VK.
 * Требование: только цифры, международный формат (например, 79991234567), sha256 в hex.
 */
export function hashPhone(phone?: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) {
    digits = "7" + digits.slice(1);
  }
  if (digits.length < 10) return null;
  return createHash("sha256").update(digits).digest("hex");
}
