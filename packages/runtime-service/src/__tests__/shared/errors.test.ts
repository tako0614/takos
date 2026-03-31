import {
  SymlinkEscapeError,
  SymlinkNotAllowedError,
  SymlinkWriteError,
  OwnerBindingError,
  isBoundaryViolationError,
} from '../../shared/errors.ts';

// ---------------------------------------------------------------------------
// SymlinkEscapeError
// ---------------------------------------------------------------------------


import { assertEquals, assert } from 'jsr:@std/assert';

  Deno.test('SymlinkEscapeError - sets correct name and message', () => {
  const err = new SymlinkEscapeError('workspace');
    assertEquals(err.name, 'SymlinkEscapeError');
    assertEquals(err.message, 'Symlink escape detected in workspace path');
})
  Deno.test('SymlinkEscapeError - is instanceof Error', () => {
  const err = new SymlinkEscapeError('test');
    assert(err instanceof Error);
})
// ---------------------------------------------------------------------------
// SymlinkNotAllowedError
// ---------------------------------------------------------------------------


  Deno.test('SymlinkNotAllowedError - sets message with label', () => {
  const err = new SymlinkNotAllowedError('file');
    assertEquals(err.name, 'SymlinkNotAllowedError');
    assertEquals(err.message, 'Symlinks are not allowed in file path');
})
  Deno.test('SymlinkNotAllowedError - sets default message without label', () => {
  const err = new SymlinkNotAllowedError();
    assertEquals(err.message, 'Symlinks are not allowed');
})
  Deno.test('SymlinkNotAllowedError - is instanceof Error', () => {
  const err = new SymlinkNotAllowedError();
    assert(err instanceof Error);
})
// ---------------------------------------------------------------------------
// SymlinkWriteError
// ---------------------------------------------------------------------------


  Deno.test('SymlinkWriteError - sets correct name and message', () => {
  const err = new SymlinkWriteError();
    assertEquals(err.name, 'SymlinkWriteError');
    assertEquals(err.message, 'Cannot write to symlinks');
})
  Deno.test('SymlinkWriteError - is instanceof Error', () => {
  assert(new SymlinkWriteError() instanceof Error);
})
// ---------------------------------------------------------------------------
// OwnerBindingError
// ---------------------------------------------------------------------------


  Deno.test('OwnerBindingError - sets default message', () => {
  const err = new OwnerBindingError();
    assertEquals(err.name, 'OwnerBindingError');
    assertEquals(err.message, 'Session does not belong to the authenticated owner');
})
  Deno.test('OwnerBindingError - accepts custom message', () => {
  const err = new OwnerBindingError('Custom error message');
    assertEquals(err.message, 'Custom error message');
})
  Deno.test('OwnerBindingError - is instanceof Error', () => {
  assert(new OwnerBindingError() instanceof Error);
})
// ---------------------------------------------------------------------------
// isBoundaryViolationError
// ---------------------------------------------------------------------------


  Deno.test('isBoundaryViolationError - returns true for SymlinkEscapeError', () => {
  assertEquals(isBoundaryViolationError(new SymlinkEscapeError('test')), true);
})
  Deno.test('isBoundaryViolationError - returns true for SymlinkNotAllowedError', () => {
  assertEquals(isBoundaryViolationError(new SymlinkNotAllowedError()), true);
})
  Deno.test('isBoundaryViolationError - returns true for SymlinkWriteError', () => {
  assertEquals(isBoundaryViolationError(new SymlinkWriteError()), true);
})
  Deno.test('isBoundaryViolationError - returns false for regular Error', () => {
  assertEquals(isBoundaryViolationError(new Error('plain error')), false);
})
  Deno.test('isBoundaryViolationError - returns false for non-error values', () => {
  assertEquals(isBoundaryViolationError(null), false);
    assertEquals(isBoundaryViolationError(undefined), false);
    assertEquals(isBoundaryViolationError('string'), false);
    assertEquals(isBoundaryViolationError(42), false);
})
  Deno.test('isBoundaryViolationError - returns false for OwnerBindingError', () => {
  assertEquals(isBoundaryViolationError(new OwnerBindingError()), false);
})