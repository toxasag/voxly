import {
  Globe,
  Instagram,
  MessageCircle,
  Phone,
  Send,
  Share2,
  type LucideIcon,
} from "lucide-react";
import type { SocialKind } from "@/schemas/contact.schema";

// ---------------------------------------------------------------------------
// Мессенджеры и соцсети контакта.
//
// У Twenty на Person под каждую сеть отдельное поле LINKS, добавляемое миграцией
// метаданных. Здесь список: набор мессенджеров у российского клиента меняется
// чаще, чем можно выпускать миграции, поэтому сети описаны данными, а не схемой.
//
// Ссылка строится по шаблону сети: у карточки должен работать переход в чат, а
// не только отображение username. Для сетей без предсказуемого адреса профиля
// (`other`) шаблона нет, и значение показывается текстом.
// ---------------------------------------------------------------------------

export interface SocialDefinition {
  kind: SocialKind;
  label: string;
  placeholder: string;
  /** Собирает ссылку на профиль/чат; null — переход невозможен. */
  href: (value: string) => string | null;
}

/** Снимает @ и обрамляющие пробелы: пользователь вводит username и так, и так. */
function username(value: string): string {
  return value.trim().replace(/^@/, "");
}

/** Оставляет цифры: WhatsApp и Viber адресуются номером, а не username. */
function digits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Уже готовая ссылка пропускается как есть — пользователь мог вставить её целиком. */
function asUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

export const SOCIAL_DEFINITIONS: readonly SocialDefinition[] = [
  {
    kind: "telegram",
    label: "Telegram",
    placeholder: "@username",
    href: (value) => asUrl(value) ?? (username(value) === "" ? null : `https://t.me/${username(value)}`),
  },
  {
    kind: "whatsapp",
    label: "WhatsApp",
    placeholder: "+7 999 123 45 67",
    href: (value) => asUrl(value) ?? (digits(value) === "" ? null : `https://wa.me/${digits(value)}`),
  },
  {
    kind: "max",
    label: "MAX",
    placeholder: "@username или номер",
    href: (value) => asUrl(value),
  },
  {
    kind: "viber",
    label: "Viber",
    placeholder: "+7 999 123 45 67",
    href: (value) =>
      asUrl(value) ?? (digits(value) === "" ? null : `viber://chat?number=${digits(value)}`),
  },
  {
    kind: "vk",
    label: "VK",
    placeholder: "id123456 или короткое имя",
    href: (value) => asUrl(value) ?? (username(value) === "" ? null : `https://vk.com/${username(value)}`),
  },
  {
    kind: "instagram",
    label: "Instagram",
    placeholder: "@username",
    href: (value) =>
      asUrl(value) ?? (username(value) === "" ? null : `https://instagram.com/${username(value)}`),
  },
  {
    kind: "other",
    label: "Другое",
    placeholder: "Ссылка или контакт",
    href: (value) => asUrl(value),
  },
];

const BY_KIND = new Map<SocialKind, SocialDefinition>(
  SOCIAL_DEFINITIONS.map((definition) => [definition.kind, definition]),
);

export function socialDefinition(kind: SocialKind): SocialDefinition {
  // `other` как запас: сеть могла быть записана более новой версией клиента.
  return BY_KIND.get(kind) ?? SOCIAL_DEFINITIONS[SOCIAL_DEFINITIONS.length - 1]!;
}

export function socialLabel(kind: SocialKind): string {
  return socialDefinition(kind).label;
}

export function socialHref(kind: SocialKind, value: string): string | null {
  return socialDefinition(kind).href(value);
}

export function socialIcon(kind: SocialKind): LucideIcon {
  switch (kind) {
    case "telegram":
      return Send;
    case "whatsapp":
      return Phone;
    case "max":
      return MessageCircle;
    case "viber":
      return Phone;
    case "vk":
      return Share2;
    case "instagram":
      return Instagram;
    case "other":
    default:
      return Globe;
  }
}

/**
 * Проверяет, является ли значение соцсети пользовательским (телефон, юзернейм, URL),
 * а не внутренним техническим идентификатором (например, чат-ID или ID пользователя MAX).
 * Технические ID хранятся в custom_fields (max_chat_id, max_user_id), а пользователю
 * в UI не показываются, так как с ними человек ничего сделать не может.
 */
export function isDisplayableSocial(
  social: { kind?: string | null; value?: string | null } | null | undefined,
): boolean {
  if (!social || !social.value) return false;
  const val = social.value.trim();
  if (!val) return false;

  // Технический ID MAX (например, 461879064, max://...):
  if (social.kind === "max") {
    if (val.startsWith("max://")) return false;
    // Числовые ID чатов/пользователей — это 1-10 цифр без плюса. Телефон в России начинается с + или имеет 11+ цифр.
    if (/^\d{1,10}$/.test(val)) return false;
    // Если это id с плюсом вроде +461879064 (менее 11 цифр):
    if (/^\+\d{1,10}$/.test(val)) return false;
  }

  // Также для telegram: числовой ID без @ (например, "123456789")
  if (social.kind === "telegram") {
    if (/^\d+$/.test(val)) return false;
  }

  return true;
}
