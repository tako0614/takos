import { compareSemver, getUpdateType } from '../store-install.ts';

// ── compareSemver ───────────────────────────────────────────────────────────


import { assertEquals, assertThrows } from 'jsr:@std/assert';

  Deno.test('compareSemver - returns -1 when a < b (minor)', () => {
  assertEquals(compareSemver('1.0.0', '1.1.0'), -1);
})
  Deno.test('compareSemver - returns 1 when a > b (major)', () => {
  assertEquals(compareSemver('2.0.0', '1.0.0'), 1);
})
  Deno.test('compareSemver - returns 0 when versions are equal', () => {
  assertEquals(compareSemver('1.0.0', '1.0.0'), 0);
})
  Deno.test('compareSemver - returns -1 when a < b (patch)', () => {
  assertEquals(compareSemver('1.0.0', '1.0.1'), -1);
})
  Deno.test('compareSemver - returns 1 when a > b (patch)', () => {
  assertEquals(compareSemver('1.0.2', '1.0.1'), 1);
})
  Deno.test('compareSemver - handles v prefix', () => {
  assertEquals(compareSemver('v1.0.0', 'v1.1.0'), -1);
    assertEquals(compareSemver('v2.0.0', '1.0.0'), 1);
    assertEquals(compareSemver('1.0.0', 'v1.0.0'), 0);
})
  Deno.test('compareSemver - throws on invalid semver', () => {
  assertThrows(() => { () => compareSemver('1.0', '1.0.0'); }, 'Invalid semver');
    assertThrows(() => { () => compareSemver('abc', '1.0.0'); }, 'Invalid semver');
    assertThrows(() => { () => compareSemver('1.0.0', ''); }, 'Invalid semver');
})
  Deno.test('compareSemver - compares multi-digit version numbers', () => {
  assertEquals(compareSemver('1.10.0', '1.9.0'), 1);
    assertEquals(compareSemver('1.0.10', '1.0.9'), 1);
    assertEquals(compareSemver('10.0.0', '9.0.0'), 1);
})
// ── getUpdateType ───────────────────────────────────────────────────────────


  Deno.test('getUpdateType - detects patch update', () => {
  assertEquals(getUpdateType('1.0.0', '1.0.1'), 'patch');
})
  Deno.test('getUpdateType - detects minor update', () => {
  assertEquals(getUpdateType('1.0.0', '1.1.0'), 'minor');
})
  Deno.test('getUpdateType - detects major update', () => {
  assertEquals(getUpdateType('1.0.0', '2.0.0'), 'major');
})
  Deno.test('getUpdateType - detects major even when minor/patch also change', () => {
  assertEquals(getUpdateType('1.2.3', '2.0.0'), 'major');
    assertEquals(getUpdateType('1.0.0', '3.5.2'), 'major');
})
  Deno.test('getUpdateType - detects minor even when patch also changes', () => {
  assertEquals(getUpdateType('1.0.0', '1.2.5'), 'minor');
})
  Deno.test('getUpdateType - handles v prefix', () => {
  assertEquals(getUpdateType('v1.0.0', 'v1.0.1'), 'patch');
    assertEquals(getUpdateType('v1.0.0', 'v2.0.0'), 'major');
})