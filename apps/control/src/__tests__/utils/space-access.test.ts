import { hasPermission } from '@/utils/space-access';


import { assertEquals } from 'jsr:@std/assert';

  Deno.test('hasPermission - returns false for null role', () => {
  assertEquals(hasPermission(null, 'viewer'), false);
})
  Deno.test('hasPermission - owner has all permissions', () => {
  assertEquals(hasPermission('owner', 'owner'), true);
    assertEquals(hasPermission('owner', 'admin'), true);
    assertEquals(hasPermission('owner', 'editor'), true);
    assertEquals(hasPermission('owner', 'viewer'), true);
})
  Deno.test('hasPermission - admin has admin, editor, viewer but not owner', () => {
  assertEquals(hasPermission('admin', 'owner'), false);
    assertEquals(hasPermission('admin', 'admin'), true);
    assertEquals(hasPermission('admin', 'editor'), true);
    assertEquals(hasPermission('admin', 'viewer'), true);
})
  Deno.test('hasPermission - editor has editor, viewer but not admin or owner', () => {
  assertEquals(hasPermission('editor', 'owner'), false);
    assertEquals(hasPermission('editor', 'admin'), false);
    assertEquals(hasPermission('editor', 'editor'), true);
    assertEquals(hasPermission('editor', 'viewer'), true);
})
  Deno.test('hasPermission - viewer only has viewer permission', () => {
  assertEquals(hasPermission('viewer', 'owner'), false);
    assertEquals(hasPermission('viewer', 'admin'), false);
    assertEquals(hasPermission('viewer', 'editor'), false);
    assertEquals(hasPermission('viewer', 'viewer'), true);
})