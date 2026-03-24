import { describe, expect, it } from 'vitest';
import { slugifyName, sanitizeRepoName } from '@/utils/slug';

describe('slugifyName', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugifyName('My Space Name')).toBe('my-space-name');
  });

  it('removes leading and trailing hyphens', () => {
    expect(slugifyName('---hello---')).toBe('hello');
  });

  it('replaces consecutive special chars with single hyphen', () => {
    expect(slugifyName('a   b___c')).toBe('a-b-c');
  });

  it('truncates to 32 characters', () => {
    const long = 'a'.repeat(50);
    expect(slugifyName(long)).toHaveLength(32);
  });

  it('returns "space" for empty/whitespace input', () => {
    expect(slugifyName('')).toBe('space');
    expect(slugifyName('   ')).toBe('space');
    expect(slugifyName('---')).toBe('space');
  });

  it('handles unicode characters by replacing them', () => {
    expect(slugifyName('café')).toBe('caf');
  });

  it('preserves numbers', () => {
    expect(slugifyName('Project 123')).toBe('project-123');
  });

  it('handles mixed special characters', () => {
    expect(slugifyName('Hello@World! #2024')).toBe('hello-world-2024');
  });
});

describe('sanitizeRepoName', () => {
  it('lowercases and trims whitespace', () => {
    expect(sanitizeRepoName('  MyRepo  ')).toBe('myrepo');
  });

  it('replaces invalid characters with hyphens', () => {
    expect(sanitizeRepoName('my repo@name')).toBe('my-repo-name');
  });

  it('preserves underscores and hyphens', () => {
    expect(sanitizeRepoName('my_repo-name')).toBe('my_repo-name');
  });

  it('preserves numbers', () => {
    expect(sanitizeRepoName('repo123')).toBe('repo123');
  });

  it('handles all-invalid characters', () => {
    expect(sanitizeRepoName('@@@@')).toBe('----');
  });

  it('handles empty string after trim', () => {
    expect(sanitizeRepoName('')).toBe('');
  });

  it('replaces dots with hyphens', () => {
    expect(sanitizeRepoName('my.repo.name')).toBe('my-repo-name');
  });

  it('handles unicode characters', () => {
    expect(sanitizeRepoName('日本語リポ')).toBe('-----');
  });
});
