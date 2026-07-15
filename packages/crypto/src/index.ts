// Voxly Crypto — AES-256-GCM symmetric encryption for secrets at rest
// (bot tokens, analytics credentials). Key from ENCRYPTION_KEY env (32-byte hex).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32`.',
    );
  }
  // Accept either a 64-char hex string (32 bytes) or a 32-byte utf-8 string.
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'utf-8');
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must be ${KEY_BYTES} bytes (got ${buf.length}). Use \`openssl rand -hex 32\`.`,
    );
  }
  return buf;
}

export interface EncryptedPayload {
  iv: string;
  tag: string;
  data: string;
}

/**
 * Encrypt a UTF-8 string. Returns a single portable string of the form
 * `{base64(iv)}:{base64(authTag)}:{base64(ciphertext)}`.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/**
 * Decrypt a string produced by {@link encrypt}. Throws on tampering (auth tag
 * mismatch) or malformed input.
 */
export function decrypt(encrypted: string): string {
  const key = getKey();
  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted payload (expected iv:tag:data).');
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf-8');
}

/** Encrypt any JSON-serializable value. */
export function encryptJSON(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

/** Decrypt and JSON.parse a value produced by {@link encryptJSON}. */
export function decryptJSON<T = unknown>(encrypted: string): T {
  return JSON.parse(decrypt(encrypted)) as T;
}

/** Random hex secret of the given byte length (default 16). */
export function generateSecret(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}
