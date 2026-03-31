// [Deno] vi.mock removed - manually stub imports from '../../shared/config.ts'
// [Deno] vi.mock removed - manually stub imports from '../../runtime/git.ts'
import {
  parseActionRef,
  validateActionComponent,
  resolveInputs,
  buildInputEnv,
} from '../../runtime/actions/action-registry.ts';

// ---------------------------------------------------------------------------
// parseActionRef
// ---------------------------------------------------------------------------


import { assertEquals, assertThrows } from 'jsr:@std/assert';

  Deno.test('parseActionRef - parses owner/repo@ref', () => {
  assertEquals(parseActionRef('actions/checkout@v4'), {
      owner: 'actions',
      repo: 'checkout',
      actionPath: '',
      ref: 'v4',
    });
})
  Deno.test('parseActionRef - parses owner/repo/subpath@ref', () => {
  assertEquals(parseActionRef('actions/toolkit/packages/core@v1'), {
      owner: 'actions',
      repo: 'toolkit',
      actionPath: 'packages/core',
      ref: 'v1',
    });
})
  Deno.test('parseActionRef - defaults to main when no @ref', () => {
  assertEquals(parseActionRef('owner/repo'), {
      owner: 'owner',
      repo: 'repo',
      actionPath: '',
      ref: 'main',
    });
})
  Deno.test('parseActionRef - handles empty ref after @', () => {
  assertEquals(parseActionRef('owner/repo@'), {
      owner: 'owner',
      repo: 'repo',
      actionPath: '',
      ref: 'main',
    });
})
  Deno.test('parseActionRef - handles single component (no slash)', () => {
  assertEquals(parseActionRef('single@v1'), {
      owner: 'single',
      repo: '',
      actionPath: '',
      ref: 'v1',
    });
})
  Deno.test('parseActionRef - handles deep nested action path', () => {
  assertEquals(parseActionRef('org/repo/a/b/c@v2'), {
      owner: 'org',
      repo: 'repo',
      actionPath: 'a/b/c',
      ref: 'v2',
    });
})
// ---------------------------------------------------------------------------
// validateActionComponent
// ---------------------------------------------------------------------------


  Deno.test('validateActionComponent - accepts valid component', () => {
  try { () => validateActionComponent('actions', 'owner'); } catch (_e) { throw new Error('Expected no throw'); };
    try { () => validateActionComponent('my-repo_v2', 'repo'); } catch (_e) { throw new Error('Expected no throw'); };
    try { () => validateActionComponent('v1.0.0', 'ref'); } catch (_e) { throw new Error('Expected no throw'); };
})
  Deno.test('validateActionComponent - rejects component with slash', () => {
  assertThrows(() => { () => validateActionComponent('path/to', 'owner'); }, 'Invalid action owner');
})
  Deno.test('validateActionComponent - rejects component with spaces', () => {
  assertThrows(() => { () => validateActionComponent('has space', 'repo'); }, 'Invalid action repo');
})
  Deno.test('validateActionComponent - rejects component with special chars', () => {
  assertThrows(() => { () => validateActionComponent('bad@char', 'ref'); }, 'Invalid action ref');
})
  Deno.test('validateActionComponent - rejects empty component', () => {
  assertThrows(() => { () => validateActionComponent('', 'owner'); }, 'Invalid action owner');
})
// ---------------------------------------------------------------------------
// resolveInputs
// ---------------------------------------------------------------------------


  Deno.test('resolveInputs - resolves provided inputs', () => {
  const definitions = {
      name: { description: 'Name', required: true },
    };
    const { resolvedInputs, missing } = resolveInputs(definitions, { name: 'John' });
    assertEquals(resolvedInputs, { name: 'John' });
    assertEquals(missing, []);
})
  Deno.test('resolveInputs - uses default values when not provided', () => {
  const definitions = {
      name: { description: 'Name', default: 'Default' },
    };
    const { resolvedInputs, missing } = resolveInputs(definitions, {});
    assertEquals(resolvedInputs, { name: 'Default' });
    assertEquals(missing, []);
})
  Deno.test('resolveInputs - reports missing required inputs', () => {
  const definitions = {
      name: { description: 'Name', required: true },
    };
    const { resolvedInputs, missing } = resolveInputs(definitions, {});
    assertEquals(missing, ['name']);
})
  Deno.test('resolveInputs - matches inputs case-insensitively', () => {
  const definitions = {
      Name: { description: 'Name', required: true },
    };
    const { resolvedInputs } = resolveInputs(definitions, { name: 'John' });
    assertEquals(resolvedInputs, { Name: 'John' });
})
  Deno.test('resolveInputs - passes through undefined definitions', () => {
  const { resolvedInputs, missing } = resolveInputs(undefined, { extra: 'value' });
    assertEquals(resolvedInputs, { extra: 'value' });
    assertEquals(missing, []);
})
  Deno.test('resolveInputs - normalizes boolean default values', () => {
  const definitions = {
      flag: { description: 'Flag', default: true },
    };
    const { resolvedInputs } = resolveInputs(definitions, {});
    assertEquals(resolvedInputs, { flag: 'true' });
})
  Deno.test('resolveInputs - normalizes null default to empty string', () => {
  const definitions = {
      val: { description: 'Val', default: null },
    };
    const { resolvedInputs } = resolveInputs(definitions, {});
    assertEquals(resolvedInputs, { val: '' });
})
  Deno.test('resolveInputs - passes through extra inputs not in definitions', () => {
  const definitions = {
      defined: { description: 'Defined' },
    };
    const { resolvedInputs } = resolveInputs(definitions, {
      defined: 'yes',
      extra: 'bonus',
    });
    assertEquals(resolvedInputs, { defined: 'yes', extra: 'bonus' });
})
// ---------------------------------------------------------------------------
// buildInputEnv
// ---------------------------------------------------------------------------


  Deno.test('buildInputEnv - creates INPUT_* env vars', () => {
  assertEquals(buildInputEnv({ name: 'John', version: '1.0' }), {
      INPUT_NAME: 'John',
      INPUT_VERSION: '1.0',
    });
})
  Deno.test('buildInputEnv - uppercases and sanitizes key names', () => {
  assertEquals(buildInputEnv({ 'my-input': 'value' }), {
      INPUT_MY_INPUT: 'value',
    });
})
  Deno.test('buildInputEnv - handles empty inputs', () => {
  assertEquals(buildInputEnv({}), {});
})
  Deno.test('buildInputEnv - replaces dots in key names', () => {
  assertEquals(buildInputEnv({ 'dotted.key': 'val' }), {
      INPUT_DOTTED_KEY: 'val',
    });
})