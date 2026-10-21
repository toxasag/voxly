/**
 * Утилиты для работы со списком e-mail адресов контакта.
 *
 * Основной e-mail хранится в колонке `contact.email` (для обратной совместимости,
 * быстрого поиска в БД и SQL-запросов).
 * Полный список (включая дополнительные адреса) хранится в `customFields.emails`.
 */

export function extractContactEmails(contact: {
  email?: string | null;
  customFields?: Record<string, unknown> | null;
}): string[] {
  const custom = contact.customFields?.emails;
  if (Array.isArray(custom)) {
    const valid = custom.filter((e): e is string => typeof e === "string" && e.trim() !== "");
    if (valid.length > 0) return valid;
  }
  return contact.email && contact.email.trim() !== "" ? [contact.email.trim()] : [];
}

export function prepareEmailsPayload(
  emails: string[],
  existingCustomFields?: Record<string, unknown> | null,
): {
  email: string;
  custom_fields: Record<string, unknown>;
} {
  const clean = emails.map((e) => e.trim()).filter((e) => e !== "");
  const primary = clean[0] ?? "";
  return {
    email: primary,
    custom_fields: {
      ...(existingCustomFields ?? {}),
      emails: clean,
    },
  };
}
