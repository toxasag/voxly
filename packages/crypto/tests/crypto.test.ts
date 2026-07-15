import { describe, it, expect, beforeEach } from 'vitest';

// Use a deterministic test key (32 bytes -> 64 hex chars).
const TEST_KEY = 'a'.repeat(64);

beforeEach(() => {
  process.env.ENCRYPTION_KEY = TEST_KEY;
});

describe('@voxly/crypto', () => {
  it('encrypt/decrypt round-trips a string', async () => {
    const { encrypt, decrypt } = await import('../src/index');
    const plaintext = '77012345678:AAH-DUMMY-TOKEN-xyz';
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.split(':')).toHaveLength(3);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it('produces a fresh IV per encryption (non-deterministic)', async () => {
    const { encrypt } = await import('../src/index');
    const a = encrypt('same-value');
    const b = encrypt('same-value');
    expect(a).not.toBe(b);
  });

  it('rejects tampered ciphertext (auth tag mismatch)', async () => {
    const { encrypt, decrypt } = await import('../src/index');
    const encrypted = encrypt('secret');
    const [iv, tag, data] = encrypted.split(':');
    // Flip a bit in the ciphertext.
    const tamperedData = Buffer.from(data, 'base64');
    tamperedData[0] ^= 0xff;
    const tampered = [iv, tag, tamperedData.toString('base64')].join(':');
    expect(() => decrypt(tampered)).toThrow();
  });

  it('rejects a wrong key on decrypt', async () => {
    const { encrypt, decrypt } = await import('../src/index');
    const encrypted = encrypt('secret');
    process.env.ENCRYPTION_KEY = 'b'.repeat(64);
    expect(() => decrypt(encrypted)).toThrow();
  });

  it('encryptJSON/decryptJSON round-trip an object', async () => {
    const { encryptJSON, decryptJSON } = await import('../src/index');
    const creds = { ymToken: 'abc', counter: 12345, nested: { a: true } };
    const encrypted = encryptJSON(creds);
    expect(decryptJSON(encrypted)).toEqual(creds);
  });

  it('throws when ENCRYPTION_KEY is missing', async () => {
    const { encrypt } = await import('../src/index');
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY/);
  });

  it('throws when ENCRYPTION_KEY is the wrong length', async () => {
    const { encrypt } = await import('../src/index');
    process.env.ENCRYPTION_KEY = 'too-short';
    expect(() => encrypt('x')).toThrow(/32 bytes/);
  });

  it('generateSecret returns hex of the requested length', async () => {
    const { generateSecret } = await import('../src/index');
    const s = generateSecret(16);
    expect(s).toMatch(/^[0-9a-f]{32}$/);
  });
});
