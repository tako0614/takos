import { CustomDomainError } from '@/services/platform/custom-domains';


import { assertEquals, assert } from 'jsr:@std/assert';

  Deno.test('CustomDomainError - has correct properties', () => {
  const err = new CustomDomainError('Not found', 404);
    assertEquals(err.message, 'Not found');
    assertEquals(err.status, 404);
    assertEquals(err.details, undefined);
})
  Deno.test('CustomDomainError - supports optional details', () => {
  const err = new CustomDomainError('Invalid domain', 400, 'must be routable');
    assertEquals(err.details, 'must be routable');
})
  Deno.test('CustomDomainError - inherits from Error', () => {
  const err = new CustomDomainError('test', 500);
    assert(err instanceof Error);
})