import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  generateId: vi.fn().mockReturnValue('skill-new'),
  now: vi.fn().mockReturnValue('2026-03-24T00:00:00.000Z'),
  listMcpServers: vi.fn().mockResolvedValue([]),
  listSkillTemplates: vi.fn().mockReturnValue([]),
  hasSkillTemplate: vi.fn().mockReturnValue(true),
  validateCustomSkillMetadata: vi.fn().mockReturnValue({ normalized: {}, fieldErrors: {} }),
  normalizeCustomSkillMetadata: vi.fn((v: unknown) => v || {}),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/utils')>()),
  generateId: mocks.generateId,
  now: mocks.now,
}));

vi.mock('@/services/platform/mcp', () => ({
  listMcpServers: mocks.listMcpServers,
}));

vi.mock('@/services/agent/skill-templates', () => ({
  listSkillTemplates: mocks.listSkillTemplates,
  hasSkillTemplate: mocks.hasSkillTemplate,
}));

vi.mock('@/services/agent/official-skills', () => ({
  validateCustomSkillMetadata: mocks.validateCustomSkillMetadata,
  normalizeCustomSkillMetadata: mocks.normalizeCustomSkillMetadata,
  listLocalizedOfficialSkills: vi.fn().mockReturnValue([]),
  getOfficialSkillById: vi.fn().mockReturnValue(null),
  resolveSkillLocale: vi.fn().mockReturnValue('en'),
}));

vi.mock('@/services/agent/skills', () => ({
  applySkillAvailability: vi.fn((skills: any[]) => skills),
}));

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
  const getMock = vi.fn();
  const allMock = vi.fn();
  const runMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    _: { get: getMock, all: allMock, run: runMock },
  };
}

describe('parseTriggers', () => {
  it('parses comma-separated triggers', () => {
    expect(parseTriggers('hello, world, test')).toEqual(['hello', 'world', 'test']);
  });

  it('returns empty array for null', () => {
    expect(parseTriggers(null)).toEqual([]);
  });

  it('filters empty strings', () => {
    expect(parseTriggers('a,,b,')).toEqual(['a', 'b']);
  });
});

describe('parseSkillMetadata', () => {
  it('returns empty object for null/undefined', () => {
    expect(parseSkillMetadata(null)).toEqual({});
    expect(parseSkillMetadata(undefined)).toEqual({});
  });

  it('returns empty object for empty string', () => {
    expect(parseSkillMetadata('')).toEqual({});
    expect(parseSkillMetadata('  ')).toEqual({});
  });

  it('returns empty object for invalid JSON', () => {
    expect(parseSkillMetadata('not json')).toEqual({});
  });

  it('parses valid JSON metadata', () => {
    mocks.normalizeCustomSkillMetadata.mockReturnValueOnce({ category: 'research' });
    const result = parseSkillMetadata('{"category":"research"}');
    expect(result).toEqual({ category: 'research' });
  });
});

describe('formatSkill', () => {
  it('formats a skill row', () => {
    mocks.normalizeCustomSkillMetadata.mockReturnValueOnce({});
    const skill = {
      id: 's1',
      space_id: 'ws-1',
      name: 'my-skill',
      description: 'A skill',
      instructions: 'Do this',
      triggers: 'hello,world',
      metadata: '{}',
      enabled: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };

    const result = formatSkill(skill);
    expect(result.id).toBe('s1');
    expect(result.name).toBe('my-skill');
    expect(result.triggers).toEqual(['hello', 'world']);
    expect(result.source).toBe('custom');
    expect(result.editable).toBe(true);
  });
});

describe('listSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns formatted skills', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([
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
    ]);
    mocks.getDb.mockReturnValue(drizzle);
    mocks.normalizeCustomSkillMetadata.mockReturnValue({});

    const result = await listSkills({} as D1Database, 'ws-1');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('skill-1');
    expect(result[0].source).toBe('custom');
  });
});

describe('getSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(undefined);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await getSkill({} as D1Database, 'ws-1', 'nonexistent');
    expect(result).toBeNull();
  });

  it('returns skill row when found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce({
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
    });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await getSkill({} as D1Database, 'ws-1', 's1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('s1');
  });
});

describe('createSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates skill with trimmed values', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce({
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
    });
    mocks.getDb.mockReturnValue(drizzle);
    mocks.validateCustomSkillMetadata.mockReturnValue({ normalized: {}, fieldErrors: {} });

    const result = await createSkill({} as D1Database, 'ws-1', {
      name: '  new-skill  ',
      description: '  desc  ',
      instructions: '  do stuff  ',
      triggers: ['a', 'b'],
    });

    expect(result).not.toBeNull();
    expect(result!.id).toBe('skill-new');
    expect(drizzle.insert).toHaveBeenCalled();
  });
});

describe('updateSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when skill not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(undefined);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await updateSkill({} as D1Database, 'ws-1', 'nonexistent', { name: 'new' });
    expect(result).toBeNull();
  });
});

describe('deleteSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes skill by id', async () => {
    const drizzle = createDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);

    await deleteSkill({} as D1Database, 's1');
    expect(drizzle.delete).toHaveBeenCalled();
  });
});

describe('updateSkillEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the new enabled state', async () => {
    const drizzle = createDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);

    const result = await updateSkillEnabled({} as D1Database, 's1', false);
    expect(result).toBe(false);
    expect(drizzle.update).toHaveBeenCalled();
  });
});
