import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { getEnv } from "../config/env.js";

// ---------------------------------------------------------------------------
// Шифрование секретов подключений (`channel_accounts.credentials`).
//
// Понадобилось вместе с подключением пользовательских аккаунтов Telegram:
// сохранённая MTProto-сессия (StringSession) — это полный доступ к аккаунту, то
// есть чтение всех личных чатов и отправка сообщений от имени владельца. Дампа
// БД, резервной копии или SQL-инъекции достаточно, чтобы получить чужие
// переписки. RLS здесь не помогает: она ограничивает запросы приложения, а не
// доступ к файлам базы.
//
// AES-256-GCM, а не CBC: GCM даёт аутентификацию шифротекста, поэтому подмена
// значения в БД обнаруживается при расшифровке, а не приводит к попытке
// подключиться подставленной сессией.
//
// Формат хранения: `v1:<iv-base64>:<tag-base64>:<ciphertext-base64>`.
// Версия в префиксе нужна для смены ключа или алгоритма без миграции данных:
// старые строки продолжают читаться, новые пишутся в новом формате.
// ---------------------------------------------------------------------------

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
/** GCM работает с 96-битным nonce — рекомендация NIST SP 800-38D. */
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

export class CredentialsEncryptionUnavailableError extends Error {
  constructor() {
    super(
      "CREDENTIALS_ENCRYPTION_KEY is not configured: refusing to store channel credentials in plaintext",
    );
    this.name = "CredentialsEncryptionUnavailableError";
  }
}

/**
 * Читает ключ из окружения.
 *
 * Принимается hex (64 символа) или base64 — иначе `openssl rand -hex 32` и
 * `openssl rand -base64 32` давали бы разный результат, и настройка зависела бы
 * от того, какую команду выбрал администратор.
 */
function readKey(): Buffer {
  const raw = getEnv().CREDENTIALS_ENCRYPTION_KEY;

  if (raw === undefined) throw new CredentialsEncryptionUnavailableError();

  const candidate = /^[a-f0-9]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");

  if (candidate.length !== KEY_LENGTH) {
    throw new Error(
      `CREDENTIALS_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes (got ${candidate.length}). Generate one with: openssl rand -hex 32`,
    );
  }

  return candidate;
}

/** Настроено ли шифрование: канал без ключа не запускается вовсе. */
export function isEncryptionConfigured(): boolean {
  return getEnv().CREDENTIALS_ENCRYPTION_KEY !== undefined;
}

export function encryptSecret(plaintext: string): string {
  const key = readKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptSecret(stored: string): string {
  const parts = stored.split(":");

  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Stored credential is not in the expected v1 envelope format");
  }

  const [, ivPart, tagPart, dataPart] = parts;

  // Проверка через `undefined` обязательна при noUncheckedIndexedAccess: длина
  // массива уже сверена выше, но компилятор об этом не знает.
  if (ivPart === undefined || tagPart === undefined || dataPart === undefined) {
    throw new Error("Stored credential is malformed");
  }

  const key = readKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Уже зашифровано? Нужно, чтобы не зашифровать значение дважды. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(`${VERSION}:`);
}

/**
 * Сравнение секретов без утечки времени.
 *
 * Используется для одноразовых идентификаторов временных сессий: обычное `===`
 * на строках завершается на первом несовпавшем байте, что позволяет угадывать
 * значение по времени ответа.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}
