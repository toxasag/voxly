import { isBannedName } from "../crm/channel-identity.js";
import { isFakeOrDummyPhone } from "../crm/channel-identity.js";
import { isPlaceholderName } from "../crm/identity-resolution.js";

export interface MaxRawName {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  type?: string | null;
}

export interface MaxInboundAttachmentLike {
  type: string;
  fileId?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  phone?: string | number | null;
  firstName?: string | null;
  lastName?: string | null;
  vcfBody?: string | null;
  contactId?: string | number | null;
}

export interface MaxExtractedIdentity {
  firstName?: string;
  lastName?: string;
  senderName: string;
  phone?: string;
}

/**
 * Нормализует телефонный номер из MAX в формат E.164 (`+7...` для РФ).
 * Возвращает `undefined`, если номер короче 10 цифр, совпадает с `selfPhone`
 * (защита INC-113) или является синтетической заглушкой.
 */
export function normalizeMaxPhone(
  rawPhone?: string | number | bigint | null,
  selfPhone?: string | null,
): string | undefined {
  if (rawPhone === undefined || rawPhone === null) return undefined;
  const rawStr = String(rawPhone).trim();
  if (!rawStr) return undefined;

  let digits = rawStr.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return undefined;

  // Приводим российские 11-значные номера 8XXXXXXXXXX к 7XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith("8")) {
    digits = `7${digits.slice(1)}`;
  }

  if (selfPhone) {
    const selfDigits = selfPhone.replace(/\D/g, "");
    if (selfDigits.length >= 10 && digits.slice(-10) === selfDigits.slice(-10)) {
      return undefined;
    }
  }

  if (isFakeOrDummyPhone(digits)) return undefined;
  return `+${digits}`;
}

/**
 * Извлекает номер телефона и имя из vCard (`vcfBody`) во вложении CONTACT.
 */
export function parseMaxVCard(vcfBody?: string | null): {
  phone?: string;
  firstName?: string;
  lastName?: string;
} {
  if (!vcfBody || typeof vcfBody !== "string") return {};

  const telMatch = vcfBody.match(/^TEL[^:]*:([^\r\n]+)/im);
  const fnMatch = vcfBody.match(/^FN[^:]*:([^\r\n]+)/im);
  const nMatch = vcfBody.match(/^N[^:]*:([^\r\n]+)/im);

  let firstName: string | undefined;
  let lastName: string | undefined;

  if (nMatch?.[1]) {
    const parts = nMatch[1].split(";").map((p) => p.trim());
    if (parts[1]) firstName = parts[1];
    if (parts[0]) lastName = parts[0];
  }
  if (!firstName && fnMatch?.[1]) {
    const words = fnMatch[1].trim().split(/\s+/).filter(Boolean);
    if (words[0]) firstName = words[0];
    if (words.length > 1) lastName = words.slice(1).join(" ");
  }

  return {
    phone: telMatch?.[1]?.trim(),
    firstName,
    lastName,
  };
}

function cleanNameToken(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^@?\d+$/.test(trimmed)) return undefined;
  if (isBannedName(trimmed)) return undefined;
  if (isPlaceholderName(trimmed, "")) return undefined;
  return trimmed;
}

function splitFullName(fullName: string): { firstName?: string; lastName?: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

/**
 * Извлекает ФИО и телефон собеседника из всех доступных полей MAX:
 * - `names[]` (`ONEME` / `CUSTOM` из протокола MAX `CONTACT_INFO` op 32)
 * - `firstName` / `lastName` / `fullName` / `senderName`
 * - `phone` / `senderPhone` / `attachments` (`type === "CONTACT"` с `phone` или `vcfBody`)
 */
export function extractMaxIdentity(input: {
  names?: MaxRawName[] | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  senderName?: string | null;
  username?: string | null;
  phone?: string | number | bigint | null;
  senderPhone?: string | number | bigint | null;
  selfPhone?: string | null;
  attachments?: MaxInboundAttachmentLike[] | null;
}): MaxExtractedIdentity {
  let firstName: string | undefined;
  let lastName: string | undefined;

  // 1. Приоритет: структурированный массив names[] из протокола MAX
  if (Array.isArray(input.names) && input.names.length > 0) {
    const sorted = [...input.names].sort((a, b) => {
      const score = (t?: string | null) => (t === "ONEME" ? 0 : t === "CUSTOM" ? 1 : 2);
      return score(a.type) - score(b.type);
    });

    for (const entry of sorted) {
      const f = cleanNameToken(entry.firstName);
      const l = cleanNameToken(entry.lastName);
      if (f || l) {
        firstName = f ?? firstName;
        lastName = l ?? lastName;
        if (firstName && lastName) break;
      }
      const n = cleanNameToken(entry.name);
      if (n && !firstName) {
        const split = splitFullName(n);
        firstName = split.firstName;
        lastName = lastName ?? split.lastName;
      }
    }
  }

  // 2. Явные поля firstName / lastName / fullName из вебхука или диалога
  if (!firstName || !lastName) {
    const rawFirst = cleanNameToken(input.firstName);
    const rawLast = cleanNameToken(input.lastName);

    if (rawFirst && !rawLast && rawFirst.includes(" ")) {
      const split = splitFullName(rawFirst);
      firstName = firstName ?? split.firstName;
      lastName = lastName ?? split.lastName;
    } else {
      firstName = firstName ?? rawFirst;
      lastName = lastName ?? rawLast;
    }

    if ((!firstName || !lastName) && input.fullName) {
      const cleanFull = cleanNameToken(input.fullName);
      if (cleanFull) {
        const split = splitFullName(cleanFull);
        firstName = firstName ?? split.firstName;
        lastName = lastName ?? split.lastName;
      }
    }
  }

  // 3. Fallback: senderName (если это не числовой ID и не заглушка)
  if (!firstName && input.senderName) {
    const cleanSender = cleanNameToken(input.senderName);
    if (cleanSender) {
      const split = splitFullName(cleanSender);
      firstName = split.firstName;
      lastName = lastName ?? split.lastName;
    }
  }

  // 4. Телефон: прямой → senderPhone → вложение CONTACT (phone / vcfBody)
  let phone =
    normalizeMaxPhone(input.phone, input.selfPhone) ??
    normalizeMaxPhone(input.senderPhone, input.selfPhone);

  if (Array.isArray(input.attachments)) {
    for (const att of input.attachments) {
      if (att.type?.toUpperCase() !== "CONTACT") continue;
      const vcard = parseMaxVCard(att.vcfBody);
      if (!phone) {
        phone =
          normalizeMaxPhone(att.phone, input.selfPhone) ??
          normalizeMaxPhone(vcard.phone, input.selfPhone);
      }
      if (!firstName) {
        firstName = cleanNameToken(att.firstName) ?? cleanNameToken(vcard.firstName);
      }
      if (!lastName) {
        lastName = cleanNameToken(att.lastName) ?? cleanNameToken(vcard.lastName);
      }
    }
  }

  const fullDisplay = [firstName, lastName].filter(Boolean).join(" ").trim();
  const cleanUser = input.username ? `@${input.username.replace(/^@/, "").trim()}` : undefined;
  const senderName =
    fullDisplay ||
    (cleanUser && !isBannedName(cleanUser) ? cleanUser : undefined) ||
    "Клиент MAX";

  return {
    firstName,
    lastName,
    senderName,
    phone,
  };
}
