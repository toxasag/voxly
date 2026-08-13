import { describe, it, expect, afterEach } from 'vitest';
import { isNoDebtModeEnabled } from '../src/index';

const ORIGINAL = process.env.VOXLY_AI_NO_DEBT;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.VOXLY_AI_NO_DEBT;
  else process.env.VOXLY_AI_NO_DEBT = ORIGINAL;
});

describe('isNoDebtModeEnabled', () => {
  it('is disabled when env is unset', () => {
    delete process.env.VOXLY_AI_NO_DEBT;
    expect(isNoDebtModeEnabled()).toBe(false);
  });

  it('accepts 1 / true / yes (case + whitespace insensitive)', () => {
    for (const v of ['1', 'true', 'TRUE', 'Yes', '  yes  ']) {
      process.env.VOXLY_AI_NO_DEBT = v;
      expect(isNoDebtModeEnabled()).toBe(true);
    }
  });

  it('rejects other values', () => {
    for (const v of ['0', 'false', 'no', 'off', '']) {
      process.env.VOXLY_AI_NO_DEBT = v;
      expect(isNoDebtModeEnabled()).toBe(false);
    }
  });
});
