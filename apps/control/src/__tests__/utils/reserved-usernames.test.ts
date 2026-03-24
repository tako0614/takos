import { describe, expect, it } from 'vitest';
import {
  RESERVED_USERNAMES,
  isReservedUsername,
  validateUsername,
} from '@/utils/reserved-usernames';

describe('RESERVED_USERNAMES', () => {
  it('is a non-empty Set', () => {
    expect(RESERVED_USERNAMES).toBeInstanceOf(Set);
    expect(RESERVED_USERNAMES.size).toBeGreaterThan(0);
  });

  it('contains system accounts', () => {
    expect(RESERVED_USERNAMES.has('admin')).toBe(true);
    expect(RESERVED_USERNAMES.has('root')).toBe(true);
    expect(RESERVED_USERNAMES.has('system')).toBe(true);
  });

  it('contains platform branding', () => {
    expect(RESERVED_USERNAMES.has('yurucommu')).toBe(true);
  });

  it('contains route-conflicting names', () => {
    expect(RESERVED_USERNAMES.has('login')).toBe(true);
    expect(RESERVED_USERNAMES.has('settings')).toBe(true);
    expect(RESERVED_USERNAMES.has('api')).toBe(true);
  });
});

describe('isReservedUsername', () => {
  it('returns true for reserved name (lowercase)', () => {
    expect(isReservedUsername('admin')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isReservedUsername('Admin')).toBe(true);
    expect(isReservedUsername('ADMIN')).toBe(true);
    expect(isReservedUsername('AdMiN')).toBe(true);
  });

  it('returns false for non-reserved name', () => {
    expect(isReservedUsername('johndoe')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isReservedUsername('')).toBe(false);
  });
});

describe('validateUsername', () => {
  it('returns null for a valid username', () => {
    expect(validateUsername('johndoe')).toBeNull();
  });

  it('accepts usernames with numbers', () => {
    expect(validateUsername('user123')).toBeNull();
  });

  it('accepts usernames with underscores', () => {
    expect(validateUsername('john_doe')).toBeNull();
  });

  it('accepts usernames with hyphens', () => {
    expect(validateUsername('john-doe')).toBeNull();
  });

  it('accepts minimum length (3 chars)', () => {
    expect(validateUsername('abc')).toBeNull();
  });

  it('accepts maximum length (30 chars)', () => {
    expect(validateUsername('a'.repeat(30))).toBeNull();
  });

  it('rejects empty string', () => {
    expect(validateUsername('')).toBe('Username is required');
  });

  it('rejects too short (2 chars)', () => {
    expect(validateUsername('ab')).toBe('Username must be at least 3 characters');
  });

  it('rejects too long (31 chars)', () => {
    expect(validateUsername('a'.repeat(31))).toBe('Username must be at most 30 characters');
  });

  it('rejects invalid characters', () => {
    expect(validateUsername('user@name')).toBe(
      'Username can only contain letters, numbers, underscores, and hyphens'
    );
  });

  it('rejects spaces', () => {
    expect(validateUsername('user name')).toBe(
      'Username can only contain letters, numbers, underscores, and hyphens'
    );
  });

  it('rejects dots', () => {
    expect(validateUsername('user.name')).toBe(
      'Username can only contain letters, numbers, underscores, and hyphens'
    );
  });

  it('rejects starting with underscore', () => {
    expect(validateUsername('_username')).toBe('Username must start with a letter or number');
  });

  it('rejects starting with hyphen', () => {
    expect(validateUsername('-username')).toBe('Username must start with a letter or number');
  });

  it('rejects ending with underscore', () => {
    expect(validateUsername('username_')).toBe('Username cannot end with underscore or hyphen');
  });

  it('rejects ending with hyphen', () => {
    expect(validateUsername('username-')).toBe('Username cannot end with underscore or hyphen');
  });

  it('rejects consecutive underscores', () => {
    expect(validateUsername('user__name')).toBe(
      'Username cannot have consecutive underscores or hyphens'
    );
  });

  it('rejects consecutive hyphens', () => {
    expect(validateUsername('user--name')).toBe(
      'Username cannot have consecutive underscores or hyphens'
    );
  });

  it('rejects mixed consecutive separators', () => {
    expect(validateUsername('user-_name')).toBe(
      'Username cannot have consecutive underscores or hyphens'
    );
  });

  it('rejects reserved usernames', () => {
    expect(validateUsername('admin')).toBe('This username is reserved');
    expect(validateUsername('root')).toBe('This username is reserved');
  });

  it('rejects reserved usernames case-insensitively', () => {
    expect(validateUsername('Admin')).toBe('This username is reserved');
  });
});
