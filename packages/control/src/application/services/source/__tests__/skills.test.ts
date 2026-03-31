import type { D1Database } from '@cloudflare/workers-types';

import { assertEquals, assertNotEquals, assert } from 'jsr:@std/assert';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  generateId: (() => 'skill-new'),
  now: (() => '2026-03-24T00:00:00.000Z'),
  listMcpServers: (async () => []),
  listSkillTemplates: (() => []),
  hasSkillTemplate: (() => true),
  validateCustomSkillMetadata: (() => ({ normalized: {}, fieldErrors: {} })),
  normalizeCustomSkillMetadata: (v: unknown) => v || {},
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
// [Deno] vi.mock removed - manually stub imports from '@/services/platform/mcp'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/skill-templates'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/official-skills'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/skills'
import {
  parseTriggers,
  parseSkillMetadata,
  formatSkill,
  listSkills,
  getSkill,
  getSkillByName,
  createSkill,
  updateSkill,
  deleteSkill,
  updateSkillEnabled,
  SkillMetadataValidationError,
} from '@/services/source/skills';

function createDrizzleMock() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const allMock = ((..._args: any[]) => undefined) as any;
  const runMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    set: (function(this: any) { return this; }),
    values: (function(this: any) { return this; }),
    returning: (function(this: any) { return this; }),
    orderBy: (function(this: any) { return this; }),
    limit: (function(this: any) { return this; }),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: { get: getMock, all: allMock, run: runMock },
  };
}


  Deno.test('parseTriggers - parses comma-separated triggers', () => {
  assertEquals(parseTriggers('hello, world, test'), ['hello', 'world', 'test']);
})
  Deno.test('parseTriggers - returns empty array for null', () => {
  assertEquals(parseTriggers(null), []);
})
  Deno.test('parseTriggers - filters empty strings', () => {
  assertEquals(parseTriggers('a,,b,'), ['a', 'b']);
})

  Deno.test('parseSkillMetadata - returns empty object for null/undefined', () => {
  assertEquals(parseSkillMetadata(null), {});
    assertEquals(parseSkillMetadata(undefined), {});
})
  Deno.test('parseSkillMetadata - returns empty object for empty string', () => {
  assertEquals(parseSkillMetadata(''), {});
    assertEquals(parseSkillMetadata('  '), {});
})
  Deno.test('parseSkillMetadata - returns empty object for invalid JSON', () => {
  assertEquals(parseSkillMetadata('not json'), {});
})
  Deno.test('parseSkillMetadata - parses valid JSON metadata', () => {
  mocks.normalizeCustomSkillMetadata = (() => ({ category: 'research' })) as any;
    const result = parseSkillMetadata('{"category":"research"}');
    assertEquals(result, { category: 'research' });
})

  Deno.test('formatSkill - formats a skill row', () => {
  mocks.normalizeCustomSkillMetadata = (() => ({})) as any;
    const skill = {
      id: 's1',
      spaceId: 'ws-1',
      name: 'my-skill',
      description: 'A skill',
      instructions: 'Do this',
      triggers: 'hello,world',
      metadata: '{}',
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const result = formatSkill(skill);
    assertEquals(result.id, 's1');
    assertEquals(result.name, 'my-skill');
    assertEquals(result.triggers, ['hello', 'world']);
    assertEquals(result.source, 'custom');
    assertEquals(result.editable, true);
})

  Deno.test('listSkills - returns formatted skills', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => [
      {
        id: 's1',
        accountId: 'ws-1',
        name: 'skill-1',
        description: null,
        instructions: 'test',
        triggers: null,
        metadata: '{}',
        enabled: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]) as any;
    mocks.getDb = (() => drizzle) as any;
    mocks.normalizeCustomSkillMetadata = (() => ({})) as any;

    const result = await listSkills({} as D1Database, 'ws-1');
    assertEquals(result.length, 1);
    assertEquals(result[0].name, 'skill-1');
    assertEquals(result[0].source, 'custom');
})

  Deno.test('getSkill - returns null when not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => undefined) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await getSkill({} as D1Database, 'ws-1', 'nonexistent');
    assertEquals(result, null);
})
  Deno.test('getSkill - returns skill row when found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({
      id: 's1',
      accountId: 'ws-1',
      name: 'skill-1',
      description: null,
      instructions: 'test',
      triggers: null,
      metadata: null,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await getSkill({} as D1Database, 'ws-1', 's1');
    assertNotEquals(result, null);
    assertEquals(result!.id, 's1');
})

  Deno.test('createSkill - creates skill with trimmed values', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({
      id: 'skill-new',
      accountId: 'ws-1',
      name: 'new-skill',
      description: 'desc',
      instructions: 'do stuff',
      triggers: 'a,b',
      metadata: '{}',
      enabled: true,
      createdAt: '2026-03-24T00:00:00.000Z',
      updatedAt: '2026-03-24T00:00:00.000Z',
    })) as any;
    mocks.getDb = (() => drizzle) as any;
    mocks.validateCustomSkillMetadata = (() => ({ normalized: {}, fieldErrors: {} })) as any;

    const result = await createSkill({} as D1Database, 'ws-1', {
      name: '  new-skill  ',
      description: '  desc  ',
      instructions: '  do stuff  ',
      triggers: ['a', 'b'],
    });

    assertNotEquals(result, null);
    assertEquals(result!.id, 'skill-new');
    assert(drizzle.insert.calls.length > 0);
})

  Deno.test('updateSkill - returns null when skill not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => undefined) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await updateSkill({} as D1Database, 'ws-1', 'nonexistent', { name: 'new' });
    assertEquals(result, null);
})

  Deno.test('deleteSkill - deletes skill by id', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    mocks.getDb = (() => drizzle) as any;

    await deleteSkill({} as D1Database, 's1');
    assert(drizzle.delete.calls.length > 0);
})

  Deno.test('updateSkillEnabled - returns the new enabled state', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    mocks.getDb = (() => drizzle) as any;

    const result = await updateSkillEnabled({} as D1Database, 's1', false);
    assertEquals(result, false);
    assert(drizzle.update.calls.length > 0);
})