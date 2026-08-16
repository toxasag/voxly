import { describe, expect, it } from 'vitest';

import {
  shouldPersistMarker,
  shouldRefreshApp,
} from '../src/services/crm-chat-app-auto-refresh.js';

describe('crm-chat-app-auto-refresh', () => {
  describe('shouldRefreshApp', () => {
    it('refreshes on first run (no stored marker)', () => {
      expect(shouldRefreshApp(null, 'abc123')).toBe(true);
    });

    it('skips when tarball hash is unchanged', () => {
      expect(shouldRefreshApp('abc123', 'abc123')).toBe(false);
    });

    it('refreshes when tarball hash changed (new deploy)', () => {
      expect(shouldRefreshApp('abc123', 'def456')).toBe(true);
    });

    it('never refreshes without a readable tarball', () => {
      expect(shouldRefreshApp('abc123', null)).toBe(false);
      expect(shouldRefreshApp(null, null)).toBe(false);
    });
  });

  describe('shouldPersistMarker', () => {
    it('persists when every workspace reinstall succeeded', () => {
      expect(shouldPersistMarker([{ ok: true }, { ok: true }])).toBe(true);
    });

    it('does not persist on partial failure (retry next boot)', () => {
      expect(shouldPersistMarker([{ ok: true }, { ok: false }])).toBe(false);
    });

    it('does not persist when nothing was processed', () => {
      expect(shouldPersistMarker([])).toBe(false);
    });
  });
});
