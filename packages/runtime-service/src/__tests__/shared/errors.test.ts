import { describe, expect, it } from 'vitest';
import {
  SymlinkEscapeError,
  SymlinkNotAllowedError,
  SymlinkWriteError,
  OwnerBindingError,
  isBoundaryViolationError,
} from '../../shared/errors.js';

// ---------------------------------------------------------------------------
// SymlinkEscapeError
// ---------------------------------------------------------------------------

describe('SymlinkEscapeError', () => {
  it('sets correct name and message', () => {
    const err = new SymlinkEscapeError('workspace');
    expect(err.name).toBe('SymlinkEscapeError');
    expect(err.message).toBe('Symlink escape detected in workspace path');
  });

  it('is instanceof Error', () => {
    const err = new SymlinkEscapeError('test');
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// SymlinkNotAllowedError
// ---------------------------------------------------------------------------

describe('SymlinkNotAllowedError', () => {
  it('sets message with label', () => {
    const err = new SymlinkNotAllowedError('file');
    expect(err.name).toBe('SymlinkNotAllowedError');
    expect(err.message).toBe('Symlinks are not allowed in file path');
  });

  it('sets default message without label', () => {
    const err = new SymlinkNotAllowedError();
    expect(err.message).toBe('Symlinks are not allowed');
  });

  it('is instanceof Error', () => {
    const err = new SymlinkNotAllowedError();
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// SymlinkWriteError
// ---------------------------------------------------------------------------

describe('SymlinkWriteError', () => {
  it('sets correct name and message', () => {
    const err = new SymlinkWriteError();
    expect(err.name).toBe('SymlinkWriteError');
    expect(err.message).toBe('Cannot write to symlinks');
  });

  it('is instanceof Error', () => {
    expect(new SymlinkWriteError()).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// OwnerBindingError
// ---------------------------------------------------------------------------

describe('OwnerBindingError', () => {
  it('sets default message', () => {
    const err = new OwnerBindingError();
    expect(err.name).toBe('OwnerBindingError');
    expect(err.message).toBe('Session does not belong to the authenticated owner');
  });

  it('accepts custom message', () => {
    const err = new OwnerBindingError('Custom error message');
    expect(err.message).toBe('Custom error message');
  });

  it('is instanceof Error', () => {
    expect(new OwnerBindingError()).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// isBoundaryViolationError
// ---------------------------------------------------------------------------

describe('isBoundaryViolationError', () => {
  it('returns true for SymlinkEscapeError', () => {
    expect(isBoundaryViolationError(new SymlinkEscapeError('test'))).toBe(true);
  });

  it('returns true for SymlinkNotAllowedError', () => {
    expect(isBoundaryViolationError(new SymlinkNotAllowedError())).toBe(true);
  });

  it('returns true for SymlinkWriteError', () => {
    expect(isBoundaryViolationError(new SymlinkWriteError())).toBe(true);
  });

  it('returns false for regular Error', () => {
    expect(isBoundaryViolationError(new Error('plain error'))).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(isBoundaryViolationError(null)).toBe(false);
    expect(isBoundaryViolationError(undefined)).toBe(false);
    expect(isBoundaryViolationError('string')).toBe(false);
    expect(isBoundaryViolationError(42)).toBe(false);
  });

  it('returns false for OwnerBindingError', () => {
    expect(isBoundaryViolationError(new OwnerBindingError())).toBe(false);
  });
});
