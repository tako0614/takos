import type { D1Database } from '@cloudflare/workers-types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/platform/mcp', () => ({
  listMcpServers: vi.fn(async () => []),
}));

import {
  listLocalizedOfficialSkills,
  listOfficialSkillDefinitions,
  normalizeCustomSkillMetadata,
  resolveSkillLocale,
} from '@/services/agent/official-skills';
import {
  activateSelectedSkills,
  buildSkillEnhancedPrompt,
  resolveSkillPlan,
  selectRelevantSkills,
  type SkillCatalogEntry,
  type SkillContext,
} from '@/services/agent/skills';
import { listOfficialSkillsCatalog } from '@/services/source/skills';

function withAvailability<T extends {
  source: 'official' | 'custom';
  execution_contract: SkillContext['execution_contract'];
}>(skill: T): T & Pick<SkillContext, 'availability' | 'availability_reasons'> {
  return {
    ...skill,
    availability: 'available',
    availability_reasons: [],
  };
}

describe('official skills registry', () => {
  it('keeps built-in official skills uniquely identified and carries execution contracts', () => {
    const skills = listOfficialSkillDefinitions();
    const ids = skills.map((skill) => skill.id);

    expect(ids).toEqual([
      'research-brief',
      'writing-draft',
      'planning-structurer',
      'slides-author',
      'repo-app-operator',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(skills.every((skill) => skill.locales.ja.triggers.length > 0)).toBe(true);
    expect(skills.every((skill) => skill.locales.en.triggers.length > 0)).toBe(true);
    expect(skills.every((skill) => skill.execution_contract.output_modes.length > 0)).toBe(true);
  });
});

describe('skill locale resolution', () => {
  it('prefers explicit locale before inspecting text samples', () => {
    expect(resolveSkillLocale({ preferredLocale: 'ja', textSamples: ['deploy an API'] })).toBe('ja');
    expect(resolveSkillLocale({ acceptLanguage: 'ja-JP,ja;q=0.9,en;q=0.8' })).toBe('ja');
    expect(resolveSkillLocale({ textSamples: ['スライド資料を作って'] })).toBe('ja');
  });
});

describe('custom skill metadata normalization', () => {
  it('normalizes structured metadata and drops invalid values', () => {
    expect(normalizeCustomSkillMetadata({
      locale: 'ja',
      category: 'planning',
      activation_tags: ['roadmap', 'phase'],
      execution_contract: {
        preferred_tools: ['create_artifact'],
        durable_output_hints: ['artifact', 'invalid'],
        output_modes: ['artifact', 'chat', 'bogus'],
        required_mcp_servers: ['slides-mcp'],
        template_ids: ['roadmap-doc'],
      },
    })).toEqual({
      locale: 'ja',
      category: 'planning',
      activation_tags: ['roadmap', 'phase'],
      execution_contract: {
        preferred_tools: ['create_artifact'],
        durable_output_hints: ['artifact'],
        output_modes: ['artifact', 'chat'],
        required_mcp_servers: ['slides-mcp'],
        template_ids: ['roadmap-doc'],
      },
    });
  });
});

describe('skill selection', () => {
  it('selects the slide skill from thread and follow-up context, not just the latest message', () => {
    const officialSkills: SkillContext[] = listLocalizedOfficialSkills('ja').map((skill) => ({
      ...skill,
      source: 'official',
      execution_contract: {
        preferred_tools: [...skill.execution_contract.preferred_tools],
        durable_output_hints: [...skill.execution_contract.durable_output_hints],
        output_modes: [...skill.execution_contract.output_modes],
        required_mcp_servers: [...skill.execution_contract.required_mcp_servers],
        template_ids: [...skill.execution_contract.template_ids],
      },
      availability: 'available',
      availability_reasons: [],
    }));

    const selected = selectRelevantSkills(officialSkills, {
      conversation: ['3枚目だけ短くして'],
      threadTitle: '顧客向けプレゼン資料',
      threadSummary: '営業デッキを作成している',
      threadKeyPoints: ['全10枚', 'ROI の説明が必要'],
      agentType: 'default',
    });

    const slideSelection = selected.find((entry) => entry.skill.id === 'slides-author');
    expect(slideSelection).toBeTruthy();
    expect(slideSelection?.reasons.some((reason) => reason.includes('thread title'))).toBe(true);
  });

  it('uses delegated run input and execution contract hints for software tasks', () => {
    const officialSkills: SkillContext[] = listLocalizedOfficialSkills('en').map((skill) => ({
      ...skill,
      source: 'official',
      execution_contract: {
        preferred_tools: [...skill.execution_contract.preferred_tools],
        durable_output_hints: [...skill.execution_contract.durable_output_hints],
        output_modes: [...skill.execution_contract.output_modes],
        required_mcp_servers: [...skill.execution_contract.required_mcp_servers],
        template_ids: [...skill.execution_contract.template_ids],
      },
      availability: 'available',
      availability_reasons: [],
    }));

    const plan = resolveSkillPlan(officialSkills, {
      locale: 'en',
      conversation: ['make it public after it works'],
      runInput: { task: 'Create a hello world API and deploy it as an app', locale: 'en' },
      agentType: 'implementer',
      availableTemplateIds: ['research-brief', 'writing-draft', 'planning-structurer', 'slides-outline', 'speaker-notes', 'repo-app-bootstrap', 'api-worker'],
      maxTotalInstructionBytes: 100_000,
      maxPerSkillInstructionBytes: 50_000,
    });

    expect(plan.selectedSkills[0]?.skill.id).toBe('repo-app-operator');
    expect(plan.selectedSkills[0]?.reasons.some((reason) => reason.includes('output intent'))).toBe(true);
  });

  it('uses structured delegation context for skill selection and locale precedence', () => {
    const officialSkills: SkillContext[] = listLocalizedOfficialSkills('ja').map((skill) => ({
      ...skill,
      source: 'official',
      execution_contract: {
        preferred_tools: [...skill.execution_contract.preferred_tools],
        durable_output_hints: [...skill.execution_contract.durable_output_hints],
        output_modes: [...skill.execution_contract.output_modes],
        required_mcp_servers: [...skill.execution_contract.required_mcp_servers],
        template_ids: [...skill.execution_contract.template_ids],
      },
      availability: 'available',
      availability_reasons: [],
    }));

    const plan = resolveSkillPlan(officialSkills, {
      locale: 'ja',
      conversation: [],
      runInput: {
        delegation: {
          task: 'Takos の app deploy 周りを修正して',
          goal: 'sub-agent 自律性を上げる',
          deliverable: 'コード変更とテスト',
          constraints: ['既存 API を壊さない'],
          context: ['apps/control が対象'],
          acceptance_criteria: ['targeted tests pass'],
          product_hint: 'takos',
          locale: 'ja',
          parent_run_id: 'run-1',
          parent_thread_id: 'thread-1',
          root_thread_id: 'thread-1',
          thread_summary: 'Takos control の修正',
          thread_key_points: ['delegation packet を導入する'],
        },
      },
      agentType: 'implementer',
      availableTemplateIds: ['research-brief', 'writing-draft', 'planning-structurer', 'slides-outline', 'speaker-notes', 'repo-app-bootstrap', 'api-worker'],
      maxTotalInstructionBytes: 100_000,
      maxPerSkillInstructionBytes: 50_000,
    });

    expect(plan.locale).toBe('ja');
    expect(plan.selectedSkills[0]?.skill.id).toBe('repo-app-operator');
  });

  it('returns no selected skills when the context has no matching signals', () => {
    const customSkill: SkillContext = {
      id: 'custom-1',
      name: 'Workspace Macro',
      description: 'Workspace-only helper',
      instructions: 'Do a very specific workspace thing.',
      triggers: ['workspace macro'],
      source: 'custom',
      category: 'custom',
      activation_tags: [],
      execution_contract: {
        preferred_tools: [],
        durable_output_hints: [],
        output_modes: ['chat'],
        required_mcp_servers: [],
        template_ids: [],
      },
      availability: 'available',
      availability_reasons: [],
    };

    expect(selectRelevantSkills([customSkill], { conversation: ['Hello there'] })).toEqual([]);
  });
});

describe('skill prompt assembly', () => {
  it('injects only activated skill contracts and points to introspection tools for the wider catalog', () => {
    const availableSkills: SkillCatalogEntry[] = [
      {
        ...withAvailability({
        id: 'slides-author',
        name: 'Slides Author',
        description: 'Create presentation structures.',
        triggers: ['slides', 'presentation'],
        source: 'official',
        category: 'slides',
        locale: 'en',
        activation_tags: ['slides'],
        execution_contract: {
          preferred_tools: ['create_artifact'],
          durable_output_hints: ['artifact'],
          output_modes: ['chat', 'artifact'],
          required_mcp_servers: [],
          template_ids: ['slides-outline'],
        },
        }),
      },
      {
        ...withAvailability({
        id: 'custom-notes',
        name: 'Team Notes',
        description: 'Weekly update formatter.',
        triggers: ['weekly update'],
        source: 'custom',
        category: 'custom',
        execution_contract: {
          preferred_tools: [],
          durable_output_hints: [],
          output_modes: ['chat'],
          required_mcp_servers: [],
          template_ids: [],
        },
        }),
      },
    ];
    const activatedSkills = activateSelectedSkills(
      [
        {
          skill: {
            ...availableSkills[0],
            instructions: 'Build a slide-by-slide outline.',
          },
          score: 12,
          reasons: ['thread title matched trigger "slides"'],
        },
      ],
      100_000,
      50_000,
    );

    const prompt = buildSkillEnhancedPrompt('Base prompt.', {
      locale: 'en',
      availableSkills,
      selectableSkills: availableSkills,
      selectedSkills: [
        {
          skill: activatedSkills[0],
          score: 12,
          reasons: ['thread title matched trigger "slides"'],
        },
      ],
      activatedSkills,
    });

    expect(prompt).toContain('## Dynamic Skill Resolution');
    expect(prompt).toContain('skill_catalog');
    expect(prompt).toContain('## Activated Skill Contracts');
    expect(prompt).toContain('Preferred tools');
    expect(prompt).toContain('Build a slide-by-slide outline.');
    expect(prompt).not.toContain('## Available Skills');
    expect(prompt).not.toContain('Weekly update formatter.\n**Instructions:**');
  });
});

describe('official skill catalog surface', () => {
  it('returns summary data from the list surface and reserves instructions for describe', async () => {
    const catalog = await listOfficialSkillsCatalog({} as D1Database, 'ws-1', { preferredLocale: 'en' });
    expect(catalog.locale).toBe('en');
    expect(catalog.skills[0]).not.toHaveProperty('instructions');
    expect(catalog.skills[0]?.execution_contract?.preferred_tools.length).toBeGreaterThan(0);
    expect(catalog.skills[0]?.availability).toBe('available');
  });
});
