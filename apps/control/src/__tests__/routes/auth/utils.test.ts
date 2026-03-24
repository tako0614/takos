import { describe, expect, it } from 'vitest';
import { sanitizeReturnTo } from '@/routes/auth/utils';

describe('sanitizeReturnTo', () => {
  it('keeps store hub and detail routes', () => {
    expect(sanitizeReturnTo('/store')).toBe('/store');
    expect(sanitizeReturnTo('/store/installed')).toBe('/store/installed');
  });

  it('rejects invalid routes', () => {
    expect(sanitizeReturnTo('//docs')).toBe('/');
  });
});
