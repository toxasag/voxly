import { describe, expect, it } from 'vitest';
import {
  phoneDigitsOnly,
  phonesLikelySame,
  stripOwnerPhone,
} from '../src/services/max-phone-guard.js';

describe('max-phone-guard (INC-113)', () => {
  it('normalizes digits', () => {
    expect(phoneDigitsOnly('+7 (915) 094-69-44')).toBe('79150946944');
  });

  it('matches same owner phone across formats', () => {
    expect(phonesLikelySame('+79150946944', '79150946944')).toBe(true);
    expect(phonesLikelySame('9150946944', '+79150946944')).toBe(true);
    expect(phonesLikelySame('+79150910874', '+79150946944')).toBe(false);
  });

  it('strips owner phone so peer lead cannot inherit it', () => {
    expect(stripOwnerPhone('+79150946944', '79150946944')).toBeUndefined();
    expect(stripOwnerPhone('+79150910874', '79150946944')).toBe('79150910874');
    expect(stripOwnerPhone(null, '79150946944')).toBeUndefined();
    expect(stripOwnerPhone('+79150910874', null)).toBe('79150910874');
  });
});
