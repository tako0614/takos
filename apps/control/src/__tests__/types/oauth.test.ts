import { describe, expect, it } from 'vitest';
import { ALL_SCOPES } from '@/types/oauth';

describe('OAuth scope registry', () => {
  it('does not publish legacy project scopes', () => {
    expect(ALL_SCOPES).not.toContain('projects:read');
    expect(ALL_SCOPES).not.toContain('projects:write');
  });

  it('does not publish pre-spaces legacy scope aliases', () => {
    expect(ALL_SCOPES).not.toContain('workspaces:read');
    expect(ALL_SCOPES).not.toContain('workspaces:write');
  });

  it('does not publish internal deployment scopes as public OAuth scopes', () => {
    expect(ALL_SCOPES).not.toContain('apps:deploy');
    expect(ALL_SCOPES).not.toContain('takopack:install');
  });
});
