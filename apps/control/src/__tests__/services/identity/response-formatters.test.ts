import { describe, expect, it } from 'vitest';
import {
  formatRepositoryResponse,
  toWorkspaceResponse,
  toUserResponse,
} from '@/services/identity/response-formatters';
import type { User } from '@/types';

describe('formatRepositoryResponse', () => {
  it('maps database fields to API response shape', () => {
    const repo = {
      name: 'my-repo',
      description: 'A test repo',
      visibility: 'public',
      defaultBranch: 'main',
      stars: 42,
      forks: 3,
      gitEnabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };

    const result = formatRepositoryResponse(repo, 'alice');

    expect(result).toEqual({
      owner_username: 'alice',
      name: 'my-repo',
      description: 'A test repo',
      visibility: 'public',
      default_branch: 'main',
      stars: 42,
      forks: 3,
      git_enabled: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    });
  });

  it('handles null description', () => {
    const repo = {
      name: 'test',
      description: null,
      visibility: 'private',
      defaultBranch: 'main',
      stars: 0,
      forks: 0,
      gitEnabled: 0,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    };

    const result = formatRepositoryResponse(repo, 'bob');
    expect(result.description).toBeNull();
    expect(result.git_enabled).toBe(0);
    // Date objects should be converted to ISO strings
    expect(result.created_at).toBe(new Date('2026-01-01').toISOString());
  });

  it('converts Date objects in timestamps', () => {
    const repo = {
      name: 'test',
      description: null,
      visibility: 'public',
      defaultBranch: 'main',
      stars: 0,
      forks: 0,
      gitEnabled: true,
      createdAt: new Date('2026-06-15T12:00:00.000Z'),
      updatedAt: new Date('2026-06-16T12:00:00.000Z'),
    };

    const result = formatRepositoryResponse(repo, 'user');
    expect(result.created_at).toBe('2026-06-15T12:00:00.000Z');
    expect(result.updated_at).toBe('2026-06-16T12:00:00.000Z');
  });
});

describe('toWorkspaceResponse', () => {
  it('maps workspace to API response with defaults', () => {
    const ws = {
      id: 'ws-1',
      kind: 'team',
      name: 'My Team',
      slug: 'my-team',
      description: 'A team workspace',
      owner_principal_id: 'user-1',
      automation_principal_id: null,
      security_posture: 'standard' as const,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    };

    const result = toWorkspaceResponse(ws);

    expect(result).toEqual({
      id: 'ws-1',
      slug: 'my-team',
      name: 'My Team',
      description: 'A team workspace',
      kind: 'team',
      owner_principal_id: 'user-1',
      automation_principal_id: null,
      security_posture: 'standard',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    });
  });

  it('uses id as slug fallback when slug is null', () => {
    const ws = {
      id: 'ws-fallback',
      name: 'Fallback',
      slug: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };

    const result = toWorkspaceResponse(ws);
    expect(result.slug).toBe('ws-fallback');
  });

  it('uses "unknown" as slug when both slug and id are missing', () => {
    const ws = {
      name: 'No ID',
      slug: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };

    const result = toWorkspaceResponse(ws);
    expect(result.slug).toBe('unknown');
  });

  it('defaults kind to team when not specified', () => {
    const ws = {
      name: 'NoKind',
      slug: 'no-kind',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };

    const result = toWorkspaceResponse(ws);
    expect(result.kind).toBe('team');
  });

  it('defaults description to null when not specified', () => {
    const ws = {
      name: 'NoDesc',
      slug: 'no-desc',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };

    const result = toWorkspaceResponse(ws);
    expect(result.description).toBeNull();
  });

  it('defaults security_posture to standard when not specified', () => {
    const ws = {
      name: 'Default',
      slug: 'default',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };

    const result = toWorkspaceResponse(ws);
    expect(result.security_posture).toBe('standard');
  });

  it('defaults owner_principal_id to null when not specified', () => {
    const ws = {
      name: 'NoOwner',
      slug: 'no-owner',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };

    const result = toWorkspaceResponse(ws);
    expect(result.owner_principal_id).toBeNull();
  });
});

describe('toUserResponse', () => {
  it('maps user to API response without internal id', () => {
    const user: User = {
      id: 'internal-id',
      email: 'alice@example.com',
      name: 'Alice',
      username: 'alice',
      bio: 'Hello',
      picture: 'https://example.com/avatar.png',
      trust_tier: 'standard',
      setup_completed: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };

    const result = toUserResponse(user);

    expect(result).toEqual({
      email: 'alice@example.com',
      name: 'Alice',
      username: 'alice',
      picture: 'https://example.com/avatar.png',
      setup_completed: true,
    });
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('bio');
    expect(result).not.toHaveProperty('trust_tier');
  });

  it('converts falsy setup_completed to false', () => {
    const user: User = {
      id: 'internal-id',
      email: 'bob@example.com',
      name: 'Bob',
      username: 'bob',
      bio: null,
      picture: null,
      trust_tier: 'standard',
      setup_completed: false,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };

    const result = toUserResponse(user);
    expect(result.setup_completed).toBe(false);
    expect(result.picture).toBeNull();
  });
});
