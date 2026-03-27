import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@takos/cloudflare-compat';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/services/source/skills', () => ({
  createSkill: vi.fn(),
  describeAgentSkill: vi.fn(),
  getSkill: vi.fn(),
  deleteSkillByName: vi.fn(),
  formatSkill: vi.fn((skill: unknown) => skill),
  getSkillByName: vi.fn(),
  listSkillCatalog: vi.fn(),
  listSkillContext: vi.fn(),
  listSkills: vi.fn(),
  updateSkill: vi.fn(),
  updateSkillEnabled: vi.fn(),
  updateSkillByName: vi.fn(),
  updateSkillEnabledByName: vi.fn(),
}));

vi.mock('@/services/agent/official-skills', () => ({
  resolveSkillLocale: vi.fn(({ preferredLocale }: { preferredLocale?: string }) => preferredLocale || 'en'),
}));

import {
  createSkill,
  describeAgentSkill,
  getSkill,
  deleteSkillByName,
  getSkillByName,
  listSkillCatalog,
  listSkillContext,
  listSkills,
  updateSkill,
  updateSkillEnabled,
  updateSkillByName,
  updateSkillEnabledByName,
} from '@/services/source/skills';

import {
  SKILL_LIST,
  SKILL_GET,
  SKILL_CREATE,
  SKILL_UPDATE,
  SKILL_TOGGLE,
  SKILL_DELETE,
  SKILL_CONTEXT,
  SKILL_CATALOG,
  SKILL_DESCRIBE,
  WORKSPACE_SKILL_TOOLS,
  WORKSPACE_SKILL_HANDLERS,
  skillListHandler,
  skillGetHandler,
  skillCreateHandler,
  skillUpdateHandler,
  skillToggleHandler,
  skillDeleteHandler,
  skillContextHandler,
  skillCatalogHandler,
  skillDescribeHandler,
} from '@/tools/builtin/space-skills';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: 'ws-test',
    threadId: 'thread-1',
    runId: 'run-1',
    userId: 'user-1',
    capabilities: [],
    env: {} as Env,
    db: {} as D1Database,
    setSessionId: vi.fn(),
    getLastContainerStartFailure: vi.fn(() => undefined),
    setLastContainerStartFailure: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

describe('workspace skill tool definitions', () => {
  it('defines all nine tools', () => {
    expect(WORKSPACE_SKILL_TOOLS).toHaveLength(9);
    const names = WORKSPACE_SKILL_TOOLS.map((t) => t.name);
    expect(names).toContain('skill_list');
    expect(names).toContain('skill_get');
    expect(names).toContain('skill_create');
    expect(names).toContain('skill_update');
    expect(names).toContain('skill_toggle');
    expect(names).toContain('skill_delete');
    expect(names).toContain('skill_context');
    expect(names).toContain('skill_catalog');
    expect(names).toContain('skill_describe');
  });

  it('all tools have workspace category', () => {
    for (const def of WORKSPACE_SKILL_TOOLS) {
      expect(def.category).toBe('workspace');
    }
  });

  it('WORKSPACE_SKILL_HANDLERS maps all tools', () => {
    for (const def of WORKSPACE_SKILL_TOOLS) {
      expect(WORKSPACE_SKILL_HANDLERS).toHaveProperty(def.name);
    }
  });

  it('skill_create requires name and instructions', () => {
    expect(SKILL_CREATE.parameters.required).toEqual(['name', 'instructions']);
  });

  it('skill_toggle requires enabled', () => {
    expect(SKILL_TOGGLE.parameters.required).toEqual(['enabled']);
  });

  it('skill_list has no required params', () => {
    expect(SKILL_LIST.parameters.required).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// skillListHandler
// ---------------------------------------------------------------------------

describe('skillListHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a list of skills', async () => {
    vi.mocked(listSkills).mockResolvedValue([
      { id: 's1', name: 'research', enabled: true },
      { id: 's2', name: 'coding', enabled: false },
    ] as any);

    const result = JSON.parse(await skillListHandler({}, makeContext()));

    expect(result.count).toBe(2);
    expect(result.skills).toHaveLength(2);
  });

  it('returns empty list', async () => {
    vi.mocked(listSkills).mockResolvedValue([]);

    const result = JSON.parse(await skillListHandler({}, makeContext()));
    expect(result.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// skillGetHandler
// ---------------------------------------------------------------------------

describe('skillGetHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when neither skill_id nor skill_name is provided', async () => {
    await expect(skillGetHandler({}, makeContext())).rejects.toThrow(
      'skill_id or skill_name is required',
    );
  });

  it('gets skill by id', async () => {
    vi.mocked(getSkill).mockResolvedValue({ id: 's1', name: 'research' } as any);

    const result = JSON.parse(
      await skillGetHandler({ skill_id: 's1' }, makeContext()),
    );
    expect(result.skill.id).toBe('s1');
  });

  it('gets skill by name', async () => {
    vi.mocked(getSkillByName).mockResolvedValue({ id: 's1', name: 'research' } as any);

    const result = JSON.parse(
      await skillGetHandler({ skill_name: 'research' }, makeContext()),
    );
    expect(result.skill.name).toBe('research');
  });

  it('throws when skill not found', async () => {
    vi.mocked(getSkill).mockResolvedValue(null);

    await expect(
      skillGetHandler({ skill_id: 'missing' }, makeContext()),
    ).rejects.toThrow('Skill not found');
  });
});

// ---------------------------------------------------------------------------
// skillCreateHandler
// ---------------------------------------------------------------------------

describe('skillCreateHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when name is empty', async () => {
    await expect(
      skillCreateHandler({ name: '', instructions: 'test' }, makeContext()),
    ).rejects.toThrow('name is required');
  });

  it('throws when instructions is empty', async () => {
    await expect(
      skillCreateHandler({ name: 'test', instructions: '' }, makeContext()),
    ).rejects.toThrow('instructions is required');
  });

  it('throws when skill already exists', async () => {
    vi.mocked(getSkillByName).mockResolvedValue({ id: 's1' } as any);

    await expect(
      skillCreateHandler({ name: 'existing', instructions: 'test' }, makeContext()),
    ).rejects.toThrow('Skill already exists');
  });

  it('creates a skill', async () => {
    vi.mocked(getSkillByName).mockResolvedValue(null);
    vi.mocked(createSkill).mockResolvedValue({
      id: 's-new',
      name: 'new-skill',
      instructions: 'Do something',
    } as any);

    const result = JSON.parse(
      await skillCreateHandler(
        { name: 'new-skill', instructions: 'Do something', triggers: ['hello'] },
        makeContext(),
      ),
    );

    expect(result.skill.id).toBe('s-new');
    expect(createSkill).toHaveBeenCalledWith(
      expect.anything(),
      'ws-test',
      expect.objectContaining({
        name: 'new-skill',
        instructions: 'Do something',
        triggers: ['hello'],
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// skillUpdateHandler
// ---------------------------------------------------------------------------

describe('skillUpdateHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when neither id nor name is provided', async () => {
    await expect(
      skillUpdateHandler({ instructions: 'new' }, makeContext()),
    ).rejects.toThrow('skill_id or skill_name is required');
  });

  it('updates skill by id', async () => {
    vi.mocked(updateSkill).mockResolvedValue({ id: 's1', name: 'updated' } as any);

    const result = JSON.parse(
      await skillUpdateHandler(
        { skill_id: 's1', instructions: 'updated instructions' },
        makeContext(),
      ),
    );
    expect(result.skill.name).toBe('updated');
  });

  it('updates skill by name', async () => {
    vi.mocked(updateSkillByName).mockResolvedValue({ id: 's1', name: 'research' } as any);

    const result = JSON.parse(
      await skillUpdateHandler(
        { skill_name: 'research', instructions: 'new' },
        makeContext(),
      ),
    );
    expect(result.skill.name).toBe('research');
  });

  it('throws when skill not found', async () => {
    vi.mocked(updateSkill).mockResolvedValue(null);

    await expect(
      skillUpdateHandler({ skill_id: 'missing', instructions: 'x' }, makeContext()),
    ).rejects.toThrow('Skill not found');
  });
});

// ---------------------------------------------------------------------------
// skillToggleHandler
// ---------------------------------------------------------------------------

describe('skillToggleHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when neither id nor name is provided', async () => {
    await expect(
      skillToggleHandler({ enabled: true }, makeContext()),
    ).rejects.toThrow('skill_id or skill_name is required');
  });

  it('toggles skill by id', async () => {
    vi.mocked(getSkill).mockResolvedValue({ id: 's1', name: 'test' } as any);

    const result = JSON.parse(
      await skillToggleHandler({ skill_id: 's1', enabled: true }, makeContext()),
    );

    expect(result.success).toBe(true);
    expect(result.enabled).toBe(true);
    expect(updateSkillEnabled).toHaveBeenCalledWith(expect.anything(), 's1', true);
  });

  it('toggles skill by name', async () => {
    const result = JSON.parse(
      await skillToggleHandler({ skill_name: 'research', enabled: false }, makeContext()),
    );

    expect(result.success).toBe(true);
    expect(result.enabled).toBe(false);
    expect(updateSkillEnabledByName).toHaveBeenCalled();
  });

  it('throws when skill_id not found', async () => {
    vi.mocked(getSkill).mockResolvedValue(null);

    await expect(
      skillToggleHandler({ skill_id: 'missing', enabled: true }, makeContext()),
    ).rejects.toThrow('Skill not found');
  });
});

// ---------------------------------------------------------------------------
// skillDeleteHandler
// ---------------------------------------------------------------------------

describe('skillDeleteHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when neither id nor name is provided', async () => {
    await expect(
      skillDeleteHandler({}, makeContext()),
    ).rejects.toThrow('skill_id or skill_name is required');
  });

  it('deletes by id', async () => {
    vi.mocked(getSkill).mockResolvedValue({ id: 's1', name: 'test' } as any);

    const result = JSON.parse(
      await skillDeleteHandler({ skill_id: 's1' }, makeContext()),
    );

    expect(result.success).toBe(true);
    expect(deleteSkillByName).toHaveBeenCalledWith(expect.anything(), 'ws-test', 'test');
  });

  it('deletes by name', async () => {
    const result = JSON.parse(
      await skillDeleteHandler({ skill_name: 'research' }, makeContext()),
    );

    expect(result.success).toBe(true);
    expect(deleteSkillByName).toHaveBeenCalledWith(expect.anything(), 'ws-test', 'research');
  });

  it('throws when skill_id not found', async () => {
    vi.mocked(getSkill).mockResolvedValue(null);

    await expect(
      skillDeleteHandler({ skill_id: 'missing' }, makeContext()),
    ).rejects.toThrow('Skill not found');
  });
});

// ---------------------------------------------------------------------------
// skillContextHandler
// ---------------------------------------------------------------------------

describe('skillContextHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns skill context with locale', async () => {
    vi.mocked(listSkillContext).mockResolvedValue({
      locale: 'ja',
      available_skills: [{ id: 'official-1', name: 'Research Brief' }],
    } as any);

    const result = JSON.parse(
      await skillContextHandler({ locale: 'ja' }, makeContext()),
    );

    expect(result.locale).toBe('ja');
    expect(result.count).toBe(1);
    expect(result.available_skills[0].name).toBe('Research Brief');
  });
});

// ---------------------------------------------------------------------------
// skillCatalogHandler
// ---------------------------------------------------------------------------

describe('skillCatalogHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns full catalog', async () => {
    vi.mocked(listSkillCatalog).mockResolvedValue({
      locale: 'en',
      available_skills: [
        { id: 'o1', name: 'Research' },
        { id: 'c1', name: 'Custom Skill' },
      ],
    } as any);

    const result = JSON.parse(await skillCatalogHandler({}, makeContext()));

    expect(result.locale).toBe('en');
    expect(result.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// skillDescribeHandler
// ---------------------------------------------------------------------------

describe('skillDescribeHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('describes a skill', async () => {
    vi.mocked(describeAgentSkill).mockResolvedValue({
      id: 'o1',
      name: 'Research Brief',
      source: 'official',
      instructions: 'Research and summarize',
    } as any);

    const result = JSON.parse(
      await skillDescribeHandler({ skill_ref: 'research-brief' }, makeContext()),
    );

    expect(result.skill.name).toBe('Research Brief');
    expect(describeAgentSkill).toHaveBeenCalledWith(
      expect.anything(),
      'ws-test',
      expect.objectContaining({ skillRef: 'research-brief' }),
    );
  });

  it('passes source hint', async () => {
    vi.mocked(describeAgentSkill).mockResolvedValue({ id: 'c1' } as any);

    await skillDescribeHandler(
      { skill_ref: 'my-skill', source: 'custom' },
      makeContext(),
    );

    expect(describeAgentSkill).toHaveBeenCalledWith(
      expect.anything(),
      'ws-test',
      expect.objectContaining({ source: 'custom' }),
    );
  });

  it('passes deprecated skill_id and skill_name', async () => {
    vi.mocked(describeAgentSkill).mockResolvedValue({ id: 'o1' } as any);

    await skillDescribeHandler(
      { skill_id: 'old-id', skill_name: 'old-name' },
      makeContext(),
    );

    expect(describeAgentSkill).toHaveBeenCalledWith(
      expect.anything(),
      'ws-test',
      expect.objectContaining({
        skillId: 'old-id',
        skillName: 'old-name',
      }),
    );
  });
});
