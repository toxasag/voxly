import { describe, expect, it } from 'vitest';

import {
  normalizePhoneToE164,
  parseTelegramPeerFromLink,
} from '@voxly/twenty-client';

// Regression for the write-first selector (2026-08-16): person channel links
// stored by Twenty 2.22 (t.me / wa.me URLs, calling code + national number)
// must resolve to a sendable peer. The old SQL also selected bare
// `telegram`/`whatsapp` columns that no longer exist, failing whole queries.
describe('crm-chat peer resolution (Twenty 2.22 link formats)', () => {
  describe('parseTelegramPeerFromLink', () => {
    it('extracts @username from a full https t.me URL', () => {
      expect(parseTelegramPeerFromLink('https://t.me/toxasagmsk')).toEqual({
        username: 'toxasagmsk',
      });
    });

    it('extracts @username from a bare handle', () => {
      expect(parseTelegramPeerFromLink('@toxasagmsk')).toEqual({
        username: 'toxasagmsk',
      });
    });

    it('extracts userId from /open/tg/{id} and tg:// deep links', () => {
      expect(parseTelegramPeerFromLink('/open/tg/928954961')).toEqual({
        userId: '928954961',
      });
      expect(parseTelegramPeerFromLink('tg://user?id=928954961')).toEqual({
        userId: '928954961',
      });
    });

    it('never treats t.me/+phone invite links as a peer', () => {
      expect(parseTelegramPeerFromLink('https://t.me/+79150946944')).toBeNull();
    });
  });

  describe('normalizePhoneToE164', () => {
    it('normalizes wa.me link URL to E.164', () => {
      expect(normalizePhoneToE164('https://wa.me/79150946944')).toBe(
        '+79150946944',
      );
    });

    it('composes calling code + national number (non-RU safe path)', () => {
      expect(normalizePhoneToE164('+79150946944' /* +7 + 9150946944 */)).toBe(
        '+79150946944',
      );
      expect(normalizePhoneToE164('+4930901820')).toBe('+4930901820');
    });

    it('applies RU heuristics to a bare national number', () => {
      expect(normalizePhoneToE164('9150946944')).toBe('+79150946944');
      expect(normalizePhoneToE164('89150946944')).toBe('+79150946944');
    });

    it('rejects LID-like and empty values', () => {
      expect(normalizePhoneToE164('')).toBeUndefined();
      expect(normalizePhoneToE164('12345678901234')).toBeUndefined();
    });
  });
});
