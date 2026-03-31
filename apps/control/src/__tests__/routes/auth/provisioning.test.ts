import { sanitizeReturnTo } from '@/routes/auth/provisioning';


import { assertEquals } from 'jsr:@std/assert';

  Deno.test('sanitizeReturnTo - keeps store hub and detail routes', () => {
  assertEquals(sanitizeReturnTo('/store'), '/store');
    assertEquals(sanitizeReturnTo('/store/installed'), '/store/installed');
})
  Deno.test('sanitizeReturnTo - rejects invalid routes', () => {
  assertEquals(sanitizeReturnTo('//docs'), '/');
})