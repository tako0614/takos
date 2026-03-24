import { describe, expect, it } from 'vitest';
import { getErrorMessage } from '../../utils/helpers.js';

describe('getErrorMessage', () => {
  it('returns message from Error instance', () => {
    expect(getErrorMessage(new Error('test error'))).toBe('test error');
  });

  it('returns string representation for non-Error', () => {
    expect(getErrorMessage('string error')).toBe('string error');
  });

  it('handles number', () => {
    expect(getErrorMessage(42)).toBe('42');
  });

  it('handles null', () => {
    expect(getErrorMessage(null)).toBe('null');
  });

  it('handles undefined', () => {
    expect(getErrorMessage(undefined)).toBe('undefined');
  });

  it('handles object', () => {
    expect(getErrorMessage({ code: 'ERR' })).toBe('[object Object]');
  });

  it('returns message from custom error class', () => {
    class CustomError extends Error {
      constructor() {
        super('custom message');
        this.name = 'CustomError';
      }
    }
    expect(getErrorMessage(new CustomError())).toBe('custom message');
  });
});
