import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  serviceTokenEnvName,
  resolveServiceToken,
  verifyServiceToken,
  timingSafeEqualStr,
  extractBearer,
} from '../src/service-auth.js';

const TOUCHED = [
  'VOXLY_SERVICE_TOKEN',
  'VOXLY_TOKEN_GRAMJS_BRIDGE',
  'VOXLY_TOKEN_MAX_BRIDGE',
  'VOXLY_TOKEN_PLATFORM_BOT',
];

describe('service-auth', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of TOUCHED) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of TOUCHED) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe('serviceTokenEnvName', () => {
    it('normalizes service names to VOXLY_TOKEN_* env keys', () => {
      expect(serviceTokenEnvName('gramjs-bridge')).toBe('VOXLY_TOKEN_GRAMJS_BRIDGE');
      expect(serviceTokenEnvName('max-bridge')).toBe('VOXLY_TOKEN_MAX_BRIDGE');
      expect(serviceTokenEnvName('platform-bot')).toBe('VOXLY_TOKEN_PLATFORM_BOT');
      expect(serviceTokenEnvName('ai-telegram-worker')).toBe('VOXLY_TOKEN_AI_TELEGRAM_WORKER');
    });
  });

  describe('extractBearer', () => {
    it('extracts token from Bearer header', () => {
      expect(extractBearer('Bearer abc123')).toBe('abc123');
    });
    it('returns empty for non-bearer or missing header', () => {
      expect(extractBearer('')).toBe('');
      expect(extractBearer(undefined)).toBe('');
      expect(extractBearer('Basic abc')).toBe('');
    });
  });

  describe('timingSafeEqualStr', () => {
    it('true for equal strings', () => {
      expect(timingSafeEqualStr('secret', 'secret')).toBe(true);
    });
    it('false for different strings or lengths', () => {
      expect(timingSafeEqualStr('secret', 'secreta')).toBe(false);
      expect(timingSafeEqualStr('secret', 'sxcret')).toBe(false);
      expect(timingSafeEqualStr('', 'x')).toBe(false);
    });
  });

  describe('resolveServiceToken', () => {
    it('prefers per-service token over shared', () => {
      process.env.VOXLY_SERVICE_TOKEN = 'shared';
      process.env.VOXLY_TOKEN_GRAMJS_BRIDGE = 'dedicated';
      expect(resolveServiceToken('gramjs-bridge')).toBe('dedicated');
    });
    it('falls back to shared when per-service missing', () => {
      process.env.VOXLY_SERVICE_TOKEN = 'shared';
      expect(resolveServiceToken('gramjs-bridge')).toBe('shared');
    });
    it('returns empty when nothing configured', () => {
      expect(resolveServiceToken('gramjs-bridge')).toBe('');
    });
  });

  describe('verifyServiceToken', () => {
    it('accepts dedicated per-service token', () => {
      process.env.VOXLY_TOKEN_MAX_BRIDGE = 'dedicated';
      expect(verifyServiceToken('dedicated', 'max-bridge')).toBe(true);
    });
    it('accepts shared token as migration fallback', () => {
      process.env.VOXLY_SERVICE_TOKEN = 'shared';
      expect(verifyServiceToken('shared', 'max-bridge')).toBe(true);
    });
    it('accepts either dedicated or shared when both set', () => {
      process.env.VOXLY_SERVICE_TOKEN = 'shared';
      process.env.VOXLY_TOKEN_MAX_BRIDGE = 'dedicated';
      expect(verifyServiceToken('dedicated', 'max-bridge')).toBe(true);
      expect(verifyServiceToken('shared', 'max-bridge')).toBe(true);
    });
    it('rejects wrong token', () => {
      process.env.VOXLY_SERVICE_TOKEN = 'shared';
      process.env.VOXLY_TOKEN_MAX_BRIDGE = 'dedicated';
      expect(verifyServiceToken('nope', 'max-bridge')).toBe(false);
    });
    it('rejects when no token configured', () => {
      expect(verifyServiceToken('anything', 'max-bridge')).toBe(false);
    });
    it('rejects empty presented token', () => {
      process.env.VOXLY_SERVICE_TOKEN = 'shared';
      expect(verifyServiceToken('', 'max-bridge')).toBe(false);
      expect(verifyServiceToken(undefined, 'max-bridge')).toBe(false);
    });
    it("does not accept another service's dedicated token when self has its own", () => {
      process.env.VOXLY_TOKEN_MAX_BRIDGE = 'max-secret';
      process.env.VOXLY_TOKEN_GRAMJS_BRIDGE = 'gramjs-secret';
      // verifying as max-bridge: gramjs token must be rejected (no shared fallback set)
      expect(verifyServiceToken('gramjs-secret', 'max-bridge')).toBe(false);
      expect(verifyServiceToken('max-secret', 'max-bridge')).toBe(true);
    });
  });
});
