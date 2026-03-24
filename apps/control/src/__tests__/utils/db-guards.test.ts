import { describe, expect, it } from 'vitest';
import {
  isInvalidArrayBufferError,
  isValidLookupEmail,
  isValidOpaqueId,
} from '@/utils/db-guards';

describe('db guards (issue 183)', () => {
  it('detects invalid array buffer errors', () => {
    expect(
      isInvalidArrayBufferError(
        new Error('Invalid array buffer length')
      )
    ).toBe(true);
    expect(
      isInvalidArrayBufferError({
        message: 'Invalid array buffer length',
      })
    ).toBe(true);
    expect(isInvalidArrayBufferError('Invalid array buffer length')).toBe(true);
    expect(
      isInvalidArrayBufferError(
        new Error('The column `main.threads.summary` does not exist in the current database.')
      )
    ).toBe(true);
    expect(isInvalidArrayBufferError(new Error('Some other error'))).toBe(false);
  });

  it('validates opaque IDs', () => {
    expect(isValidOpaqueId('repo_123-abc')).toBe(true);
    expect(isValidOpaqueId('')).toBe(false);
    expect(isValidOpaqueId('abc.def')).toBe(false);
    expect(isValidOpaqueId('x'.repeat(129))).toBe(false);
  });

  it('validates lookup emails', () => {
    expect(isValidLookupEmail('user@example.com')).toBe(true);
    expect(isValidLookupEmail(' user@example.com ')).toBe(true);
    expect(isValidLookupEmail('invalid-email')).toBe(false);
    expect(isValidLookupEmail('x'.repeat(321))).toBe(false);
  });
});
