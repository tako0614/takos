import { describe, expect, it } from 'vitest';
import { hasPermission } from '@/utils/workspace';

describe('hasPermission', () => {
  it('returns false for null role', () => {
    expect(hasPermission(null, 'viewer')).toBe(false);
  });

  it('owner has all permissions', () => {
    expect(hasPermission('owner', 'owner')).toBe(true);
    expect(hasPermission('owner', 'admin')).toBe(true);
    expect(hasPermission('owner', 'editor')).toBe(true);
    expect(hasPermission('owner', 'viewer')).toBe(true);
  });

  it('admin has admin, editor, viewer but not owner', () => {
    expect(hasPermission('admin', 'owner')).toBe(false);
    expect(hasPermission('admin', 'admin')).toBe(true);
    expect(hasPermission('admin', 'editor')).toBe(true);
    expect(hasPermission('admin', 'viewer')).toBe(true);
  });

  it('editor has editor, viewer but not admin or owner', () => {
    expect(hasPermission('editor', 'owner')).toBe(false);
    expect(hasPermission('editor', 'admin')).toBe(false);
    expect(hasPermission('editor', 'editor')).toBe(true);
    expect(hasPermission('editor', 'viewer')).toBe(true);
  });

  it('viewer only has viewer permission', () => {
    expect(hasPermission('viewer', 'owner')).toBe(false);
    expect(hasPermission('viewer', 'admin')).toBe(false);
    expect(hasPermission('viewer', 'editor')).toBe(false);
    expect(hasPermission('viewer', 'viewer')).toBe(true);
  });
});
