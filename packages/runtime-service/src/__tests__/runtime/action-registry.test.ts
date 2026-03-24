import { describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/config.js', () => ({
  REPOS_BASE_DIR: '/repos',
  WORKDIR_BASE_DIR: '/tmp',
  GIT_ENDPOINT_URL: 'https://git.takos.dev',
}));

vi.mock('../../runtime/git.js', () => ({
  cloneAndCheckout: vi.fn(),
}));

import {
  parseActionRef,
  validateActionComponent,
  resolveInputs,
  buildInputEnv,
} from '../../runtime/actions/action-registry.js';

// ---------------------------------------------------------------------------
// parseActionRef
// ---------------------------------------------------------------------------

describe('parseActionRef', () => {
  it('parses owner/repo@ref', () => {
    expect(parseActionRef('actions/checkout@v4')).toEqual({
      owner: 'actions',
      repo: 'checkout',
      actionPath: '',
      ref: 'v4',
    });
  });

  it('parses owner/repo/subpath@ref', () => {
    expect(parseActionRef('actions/toolkit/packages/core@v1')).toEqual({
      owner: 'actions',
      repo: 'toolkit',
      actionPath: 'packages/core',
      ref: 'v1',
    });
  });

  it('defaults to main when no @ref', () => {
    expect(parseActionRef('owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
      actionPath: '',
      ref: 'main',
    });
  });

  it('handles empty ref after @', () => {
    expect(parseActionRef('owner/repo@')).toEqual({
      owner: 'owner',
      repo: 'repo',
      actionPath: '',
      ref: 'main',
    });
  });

  it('handles single component (no slash)', () => {
    expect(parseActionRef('single@v1')).toEqual({
      owner: 'single',
      repo: '',
      actionPath: '',
      ref: 'v1',
    });
  });

  it('handles deep nested action path', () => {
    expect(parseActionRef('org/repo/a/b/c@v2')).toEqual({
      owner: 'org',
      repo: 'repo',
      actionPath: 'a/b/c',
      ref: 'v2',
    });
  });
});

// ---------------------------------------------------------------------------
// validateActionComponent
// ---------------------------------------------------------------------------

describe('validateActionComponent', () => {
  it('accepts valid component', () => {
    expect(() => validateActionComponent('actions', 'owner')).not.toThrow();
    expect(() => validateActionComponent('my-repo_v2', 'repo')).not.toThrow();
    expect(() => validateActionComponent('v1.0.0', 'ref')).not.toThrow();
  });

  it('rejects component with slash', () => {
    expect(() => validateActionComponent('path/to', 'owner')).toThrow('Invalid action owner');
  });

  it('rejects component with spaces', () => {
    expect(() => validateActionComponent('has space', 'repo')).toThrow('Invalid action repo');
  });

  it('rejects component with special chars', () => {
    expect(() => validateActionComponent('bad@char', 'ref')).toThrow('Invalid action ref');
  });

  it('rejects empty component', () => {
    expect(() => validateActionComponent('', 'owner')).toThrow('Invalid action owner');
  });
});

// ---------------------------------------------------------------------------
// resolveInputs
// ---------------------------------------------------------------------------

describe('resolveInputs', () => {
  it('resolves provided inputs', () => {
    const definitions = {
      name: { description: 'Name', required: true },
    };
    const { resolvedInputs, missing } = resolveInputs(definitions, { name: 'John' });
    expect(resolvedInputs).toEqual({ name: 'John' });
    expect(missing).toEqual([]);
  });

  it('uses default values when not provided', () => {
    const definitions = {
      name: { description: 'Name', default: 'Default' },
    };
    const { resolvedInputs, missing } = resolveInputs(definitions, {});
    expect(resolvedInputs).toEqual({ name: 'Default' });
    expect(missing).toEqual([]);
  });

  it('reports missing required inputs', () => {
    const definitions = {
      name: { description: 'Name', required: true },
    };
    const { resolvedInputs, missing } = resolveInputs(definitions, {});
    expect(missing).toEqual(['name']);
  });

  it('matches inputs case-insensitively', () => {
    const definitions = {
      Name: { description: 'Name', required: true },
    };
    const { resolvedInputs } = resolveInputs(definitions, { name: 'John' });
    expect(resolvedInputs).toEqual({ Name: 'John' });
  });

  it('passes through undefined definitions', () => {
    const { resolvedInputs, missing } = resolveInputs(undefined, { extra: 'value' });
    expect(resolvedInputs).toEqual({ extra: 'value' });
    expect(missing).toEqual([]);
  });

  it('normalizes boolean default values', () => {
    const definitions = {
      flag: { description: 'Flag', default: true },
    };
    const { resolvedInputs } = resolveInputs(definitions, {});
    expect(resolvedInputs).toEqual({ flag: 'true' });
  });

  it('normalizes null default to empty string', () => {
    const definitions = {
      val: { description: 'Val', default: null },
    };
    const { resolvedInputs } = resolveInputs(definitions, {});
    expect(resolvedInputs).toEqual({ val: '' });
  });

  it('passes through extra inputs not in definitions', () => {
    const definitions = {
      defined: { description: 'Defined' },
    };
    const { resolvedInputs } = resolveInputs(definitions, {
      defined: 'yes',
      extra: 'bonus',
    });
    expect(resolvedInputs).toEqual({ defined: 'yes', extra: 'bonus' });
  });
});

// ---------------------------------------------------------------------------
// buildInputEnv
// ---------------------------------------------------------------------------

describe('buildInputEnv', () => {
  it('creates INPUT_* env vars', () => {
    expect(buildInputEnv({ name: 'John', version: '1.0' })).toEqual({
      INPUT_NAME: 'John',
      INPUT_VERSION: '1.0',
    });
  });

  it('uppercases and sanitizes key names', () => {
    expect(buildInputEnv({ 'my-input': 'value' })).toEqual({
      INPUT_MY_INPUT: 'value',
    });
  });

  it('handles empty inputs', () => {
    expect(buildInputEnv({})).toEqual({});
  });

  it('replaces dots in key names', () => {
    expect(buildInputEnv({ 'dotted.key': 'val' })).toEqual({
      INPUT_DOTTED_KEY: 'val',
    });
  });
});
