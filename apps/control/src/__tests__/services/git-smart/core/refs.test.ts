import { isValidRefName } from '@/services/git-smart/core/refs';


  
import { assertEquals } from 'jsr:@std/assert';

    it.each([
      'main',
      'feature/branch',
      'release-1.0',
      'a',
    ])('accepts "%s"', (name) => {
      assertEquals(isValidRefName(name), true);
    });
  

  
    Deno.test('isValidRefName - invalid ref names - rejects empty string', () => {
  assertEquals(isValidRefName(''), false);
})

    Deno.test('isValidRefName - invalid ref names - rejects string exceeding 255 chars', () => {
  const longName = 'a'.repeat(256);
      assertEquals(isValidRefName(longName), false);
})

    Deno.test('isValidRefName - invalid ref names - accepts string exactly at 255 chars', () => {
  const maxName = 'a'.repeat(255);
      assertEquals(isValidRefName(maxName), true);
})

    Deno.test('isValidRefName - invalid ref names - rejects name containing ".."', () => {
  assertEquals(isValidRefName('foo..bar'), false);
})

    Deno.test('isValidRefName - invalid ref names - rejects name containing "~"', () => {
  assertEquals(isValidRefName('foo~bar'), false);
})

    Deno.test('isValidRefName - invalid ref names - rejects name containing "^"', () => {
  assertEquals(isValidRefName('foo^bar'), false);
})

    Deno.test('isValidRefName - invalid ref names - rejects name containing ":"', () => {
  assertEquals(isValidRefName('foo:bar'), false);
})

    Deno.test('isValidRefName - invalid ref names - rejects name containing "?"', () => {
  assertEquals(isValidRefName('foo?bar'), false);
})

    Deno.test('isValidRefName - invalid ref names - rejects name containing "*"', () => {
  assertEquals(isValidRefName('foo*bar'), false);
})

    Deno.test('isValidRefName - invalid ref names - rejects name containing "["', () => {
  assertEquals(isValidRefName('foo[bar'), false);
})

    Deno.test('isValidRefName - invalid ref names - rejects name containing "\\\\"', () => {
  assertEquals(isValidRefName('foo\\bar'), false);
})

    Deno.test('isValidRefName - invalid ref names - rejects name ending with ".lock"', () => {
  assertEquals(isValidRefName('branch.lock'), false);
})

    Deno.test('isValidRefName - invalid ref names - rejects name ending with "."', () => {
  assertEquals(isValidRefName('branch.'), false);
})

    Deno.test('isValidRefName - invalid ref names - rejects name starting with "/"', () => {
  assertEquals(isValidRefName('/branch'), false);
})

    Deno.test('isValidRefName - invalid ref names - rejects name ending with "/"', () => {
  assertEquals(isValidRefName('branch/'), false);
})

    Deno.test('isValidRefName - invalid ref names - rejects name containing "//"', () => {
  assertEquals(isValidRefName('foo//bar'), false);
})

    Deno.test('isValidRefName - invalid ref names - rejects name containing "@{"', () => {
  assertEquals(isValidRefName('foo@{bar'), false);
})

    Deno.test('isValidRefName - invalid ref names - rejects non-ASCII characters', () => {
  assertEquals(isValidRefName('branch-\u00e9'), false);
})

    Deno.test('isValidRefName - invalid ref names - rejects null', () => {
  assertEquals(isValidRefName(null), false);
})

    Deno.test('isValidRefName - invalid ref names - rejects undefined', () => {
  assertEquals(isValidRefName(undefined), false);
})

    Deno.test('isValidRefName - invalid ref names - rejects number', () => {
  assertEquals(isValidRefName(42), false);
})
  

