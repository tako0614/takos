import { describe, expect, it } from 'vitest';

import { CustomDomainError } from '@/services/platform/custom-domains';

describe('CustomDomainError', () => {
  it('has correct properties', () => {
    const err = new CustomDomainError('Not found', 404);
    expect(err.message).toBe('Not found');
    expect(err.status).toBe(404);
    expect(err.details).toBeUndefined();
  });

  it('supports optional details', () => {
    const err = new CustomDomainError('Invalid domain', 400, 'must be routable');
    expect(err.details).toBe('must be routable');
  });

  it('inherits from Error', () => {
    const err = new CustomDomainError('test', 500);
    expect(err).toBeInstanceOf(Error);
  });
});
