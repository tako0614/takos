import { describe, expect, it } from 'vitest';
import { buildSkillTree, searchSkillsByText } from '@/services/source/skill-search';
import type { SkillCatalogEntry } from '@/services/agent/skills';

function makeSkill(overrides: Partial<SkillCatalogEntry> & { id: string; name: string }): SkillCatalogEntry {
  return {
    description: '',
    triggers: [],
    source: 'official',
    category: 'custom',
    version: '1.0.0',
    execution_contract: {
      preferred_tools: [],
      durable_output_hints: [],
      output_modes: ['chat'],
      required_mcp_servers: [],
      template_ids: [],
    },
    availability: 'available',
    availability_reasons: [],
    ...overrides,
  };
}

const OFFICIAL_SKILLS: SkillCatalogEntry[] = [
  makeSkill({ id: 'research-brief', name: 'Research Brief', category: 'research', source: 'official', description: 'Investigate a topic', triggers: ['research', 'analyze'] }),
  makeSkill({ id: 'writing-draft', name: 'Writing Draft', category: 'writing', source: 'official', description: 'Turn rough intent into a draft', triggers: ['write', 'draft'] }),
  makeSkill({ id: 'planning-structurer', name: 'Planning Structurer', category: 'planning', source: 'official', description: 'Clarify goals', triggers: ['plan', 'roadmap'] }),
  makeSkill({ id: 'slides-author', name: 'Slides Author', category: 'slides', source: 'official', description: 'Design slide decks', triggers: ['slides'] }),
  makeSkill({ id: 'repo-app-operator', name: 'Repo App Operator', category: 'software', source: 'official', description: 'Software asset management', triggers: ['repo', 'deploy'] }),
];

const CUSTOM_SKILLS: SkillCatalogEntry[] = [
  makeSkill({ id: 'custom-1', name: 'my-translator', category: 'custom', source: 'custom', description: 'Translation skill', triggers: ['translate'] }),
  makeSkill({ id: 'custom-2', name: 'data-analyzer', category: 'custom', source: 'custom', description: 'Data analysis', triggers: ['analyze'] }),
];

const ALL_SKILLS = [...OFFICIAL_SKILLS, ...CUSTOM_SKILLS];

describe('buildSkillTree', () => {
  it('groups skills by category in canonical order', () => {
    const tree = buildSkillTree(ALL_SKILLS);

    expect(tree.total_skills).toBe(ALL_SKILLS.length);

    const categories = tree.categories.map((c) => c.category);
    expect(categories).toEqual(['research', 'writing', 'planning', 'slides', 'software', 'custom']);
  });

  it('uses correct labels', () => {
    const tree = buildSkillTree(ALL_SKILLS);
    expect(tree.categories[0].label).toBe('Research');
    expect(tree.categories[5].label).toBe('Custom');
  });

  it('omits empty categories', () => {
    const tree = buildSkillTree(OFFICIAL_SKILLS);
    const categories = tree.categories.map((c) => c.category);
    expect(categories).not.toContain('custom');
    expect(tree.total_skills).toBe(5);
  });

  it('places skills with matching category under the correct node', () => {
    const tree = buildSkillTree(ALL_SKILLS);
    const customNode = tree.categories.find((c) => c.category === 'custom');
    expect(customNode).toBeDefined();
    expect(customNode!.skills).toHaveLength(2);
    expect(customNode!.skills.map((s) => s.id)).toEqual(['custom-1', 'custom-2']);
  });

  it('handles empty skill list', () => {
    const tree = buildSkillTree([]);
    expect(tree.categories).toHaveLength(0);
    expect(tree.total_skills).toBe(0);
  });
});

describe('searchSkillsByText', () => {
  it('returns exact name match with highest score', () => {
    const results = searchSkillsByText(ALL_SKILLS, 'Research Brief');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].skill.id).toBe('research-brief');
    expect(results[0].score).toBe(100);
    expect(results[0].match_source).toBe('text');
  });

  it('returns partial name matches', () => {
    const results = searchSkillsByText(ALL_SKILLS, 'Draft');
    expect(results.some((r) => r.skill.id === 'writing-draft')).toBe(true);
    const match = results.find((r) => r.skill.id === 'writing-draft')!;
    expect(match.score).toBe(60);
  });

  it('matches triggers', () => {
    const results = searchSkillsByText(ALL_SKILLS, 'translate');
    expect(results.some((r) => r.skill.id === 'custom-1')).toBe(true);
    const match = results.find((r) => r.skill.id === 'custom-1')!;
    expect(match.score).toBe(50);
  });

  it('matches description', () => {
    const results = searchSkillsByText(ALL_SKILLS, 'Design slide decks');
    expect(results.some((r) => r.skill.id === 'slides-author')).toBe(true);
  });

  it('matches category label', () => {
    const results = searchSkillsByText(ALL_SKILLS, 'software');
    expect(results.some((r) => r.skill.id === 'repo-app-operator')).toBe(true);
    const match = results.find((r) => r.skill.id === 'repo-app-operator')!;
    // description contains "Software" (score 40) which is higher than category match (30)
    expect(match.score).toBeGreaterThanOrEqual(30);
  });

  it('returns empty for non-matching query', () => {
    const results = searchSkillsByText(ALL_SKILLS, 'zzz-no-match-xyz');
    expect(results).toHaveLength(0);
  });

  it('respects limit option', () => {
    const results = searchSkillsByText(ALL_SKILLS, 'analyze', { limit: 1 });
    expect(results).toHaveLength(1);
  });

  it('sorts by score descending', () => {
    const results = searchSkillsByText(ALL_SKILLS, 'analyze');
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});
