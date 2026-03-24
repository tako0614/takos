import { describe, expect, it } from 'vitest';

import {
  listOfficialSkillDefinitions,
  listLocalizedOfficialSkills,
  getOfficialSkillById,
  localizeOfficialSkill,
  resolveSkillLocale,
  isSkillLocale,
  normalizeCustomSkillMetadata,
  validateCustomSkillMetadata,
  getCategoryLabel,
  CATEGORY_LABELS,
} from '@/services/agent/official-skills';

describe('listOfficialSkillDefinitions', () => {
  it('returns all official skills with unique IDs', () => {
    const skills = listOfficialSkillDefinitions();
    const ids = skills.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('research-brief');
    expect(ids).toContain('writing-draft');
    expect(ids).toContain('planning-structurer');
    expect(ids).toContain('slides-author');
    expect(ids).toContain('repo-app-operator');
  });

  it('returns deep clones of the definitions', () => {
    const first = listOfficialSkillDefinitions();
    const second = listOfficialSkillDefinitions();
    first[0].activation_tags.push('injected');
    expect(second[0].activation_tags).not.toContain('injected');
  });

  it('every skill has both ja and en locales', () => {
    const skills = listOfficialSkillDefinitions();
    for (const skill of skills) {
      expect(skill.locales.ja.triggers.length).toBeGreaterThan(0);
      expect(skill.locales.en.triggers.length).toBeGreaterThan(0);
      expect(skill.locales.ja.name).toBeTruthy();
      expect(skill.locales.en.name).toBeTruthy();
      expect(skill.locales.ja.instructions).toBeTruthy();
      expect(skill.locales.en.instructions).toBeTruthy();
    }
  });

  it('every skill has a valid execution contract', () => {
    const skills = listOfficialSkillDefinitions();
    for (const skill of skills) {
      expect(skill.execution_contract.output_modes.length).toBeGreaterThan(0);
      expect(skill.execution_contract.preferred_tools.length).toBeGreaterThan(0);
    }
  });
});

describe('listLocalizedOfficialSkills', () => {
  it('returns skills in the requested locale', () => {
    const jaSkills = listLocalizedOfficialSkills('ja');
    expect(jaSkills.every((s) => s.locale === 'ja')).toBe(true);
    expect(jaSkills[0].name).toMatch(/[\u3000-\u9fff]/); // contains CJK

    const enSkills = listLocalizedOfficialSkills('en');
    expect(enSkills.every((s) => s.locale === 'en')).toBe(true);
    expect(enSkills[0].name).toMatch(/^[A-Za-z\s]+$/);
  });
});

describe('getOfficialSkillById', () => {
  it('returns the skill for a valid id', () => {
    const skill = getOfficialSkillById('slides-author', 'en');
    expect(skill).not.toBeNull();
    expect(skill!.id).toBe('slides-author');
    expect(skill!.locale).toBe('en');
    expect(skill!.name).toBe('Slides Author');
  });

  it('returns null for an unknown id', () => {
    expect(getOfficialSkillById('nonexistent', 'en')).toBeNull();
  });
});

describe('localizeOfficialSkill', () => {
  it('localizes to ja', () => {
    const definitions = listOfficialSkillDefinitions();
    const localized = localizeOfficialSkill(definitions[0], 'ja');
    expect(localized.locale).toBe('ja');
    expect(localized.name).toBe(definitions[0].locales.ja.name);
    expect(localized.triggers).toEqual(definitions[0].locales.ja.triggers);
  });

  it('localizes to en', () => {
    const definitions = listOfficialSkillDefinitions();
    const localized = localizeOfficialSkill(definitions[0], 'en');
    expect(localized.locale).toBe('en');
    expect(localized.name).toBe(definitions[0].locales.en.name);
  });

  it('returns a deep clone of execution_contract', () => {
    const definitions = listOfficialSkillDefinitions();
    const localized = localizeOfficialSkill(definitions[0], 'en');
    localized.execution_contract.preferred_tools.push('injected');
    const fresh = localizeOfficialSkill(definitions[0], 'en');
    expect(fresh.execution_contract.preferred_tools).not.toContain('injected');
  });
});

describe('isSkillLocale', () => {
  it('returns true for ja and en', () => {
    expect(isSkillLocale('ja')).toBe(true);
    expect(isSkillLocale('en')).toBe(true);
  });

  it('returns false for other values', () => {
    expect(isSkillLocale('fr')).toBe(false);
    expect(isSkillLocale(null)).toBe(false);
    expect(isSkillLocale(undefined)).toBe(false);
  });
});

describe('resolveSkillLocale', () => {
  it('prefers explicit locale', () => {
    expect(resolveSkillLocale({ preferredLocale: 'ja' })).toBe('ja');
    expect(resolveSkillLocale({ preferredLocale: 'en' })).toBe('en');
  });

  it('falls back to acceptLanguage', () => {
    expect(resolveSkillLocale({ acceptLanguage: 'ja-JP,ja;q=0.9' })).toBe('ja');
    expect(resolveSkillLocale({ acceptLanguage: 'en-US,en;q=0.9' })).toBe('en');
  });

  it('detects Japanese from text samples', () => {
    expect(resolveSkillLocale({ textSamples: ['スライドを作って'] })).toBe('ja');
  });

  it('defaults to en when no signal', () => {
    expect(resolveSkillLocale({})).toBe('en');
    expect(resolveSkillLocale()).toBe('en');
  });
});

describe('normalizeCustomSkillMetadata', () => {
  it('normalizes a complete valid metadata object', () => {
    const result = normalizeCustomSkillMetadata({
      locale: 'ja',
      category: 'research',
      activation_tags: ['tag1', 'tag2'],
      execution_contract: {
        preferred_tools: ['tool1'],
        durable_output_hints: ['artifact'],
        output_modes: ['chat', 'artifact'],
        required_mcp_servers: ['server1'],
        template_ids: ['tmpl1'],
      },
    });

    expect(result.locale).toBe('ja');
    expect(result.category).toBe('research');
    expect(result.activation_tags).toEqual(['tag1', 'tag2']);
    expect(result.execution_contract?.output_modes).toEqual(['chat', 'artifact']);
  });

  it('returns empty object for non-object input', () => {
    expect(normalizeCustomSkillMetadata(null)).toEqual({});
    expect(normalizeCustomSkillMetadata('string')).toEqual({});
    expect(normalizeCustomSkillMetadata([1, 2])).toEqual({});
  });

  it('filters invalid output modes and durable hints', () => {
    const result = normalizeCustomSkillMetadata({
      execution_contract: {
        output_modes: ['chat', 'bogus', 'artifact'],
        durable_output_hints: ['artifact', 'invalid'],
      },
    });
    expect(result.execution_contract?.output_modes).toEqual(['chat', 'artifact']);
    expect(result.execution_contract?.durable_output_hints).toEqual(['artifact']);
  });

  it('ignores invalid locale and category', () => {
    const result = normalizeCustomSkillMetadata({
      locale: 'fr',
      category: 'invalid-cat',
    });
    expect(result.locale).toBeUndefined();
    expect(result.category).toBeUndefined();
  });

  it('limits activation_tags to 20', () => {
    const tags = Array.from({ length: 30 }, (_, i) => `tag${i}`);
    const result = normalizeCustomSkillMetadata({ activation_tags: tags });
    expect(result.activation_tags!.length).toBe(20);
  });
});

describe('validateCustomSkillMetadata', () => {
  it('returns no errors for valid input', () => {
    const { fieldErrors } = validateCustomSkillMetadata({
      locale: 'en',
      category: 'writing',
    });
    expect(Object.keys(fieldErrors)).toHaveLength(0);
  });

  it('reports errors for invalid locale', () => {
    const { fieldErrors } = validateCustomSkillMetadata({ locale: 123 });
    expect(fieldErrors.locale).toBeDefined();
  });

  it('reports errors for invalid category', () => {
    const { fieldErrors } = validateCustomSkillMetadata({ category: 'invalid' });
    expect(fieldErrors.category).toBeDefined();
  });

  it('reports error for non-object metadata', () => {
    const { fieldErrors } = validateCustomSkillMetadata('string');
    expect(fieldErrors.metadata).toBeDefined();
  });

  it('reports error for non-array activation_tags', () => {
    const { fieldErrors } = validateCustomSkillMetadata({ activation_tags: 'not-array' });
    expect(fieldErrors.activation_tags).toBeDefined();
  });

  it('reports error for non-object execution_contract', () => {
    const { fieldErrors } = validateCustomSkillMetadata({ execution_contract: 'bad' });
    expect(fieldErrors.execution_contract).toBeDefined();
  });

  it('reports error for invalid durable_output_hints values', () => {
    const { fieldErrors } = validateCustomSkillMetadata({
      execution_contract: { durable_output_hints: ['invalid'] },
    });
    expect(fieldErrors['execution_contract.durable_output_hints']).toBeDefined();
  });

  it('reports error for invalid output_modes values', () => {
    const { fieldErrors } = validateCustomSkillMetadata({
      execution_contract: { output_modes: ['bogus'] },
    });
    expect(fieldErrors['execution_contract.output_modes']).toBeDefined();
  });
});

describe('getCategoryLabel', () => {
  it('returns labels for all known categories', () => {
    expect(getCategoryLabel('research').label).toBe('Research');
    expect(getCategoryLabel('writing').label).toBe('Writing');
    expect(getCategoryLabel('planning').label).toBe('Planning');
    expect(getCategoryLabel('slides').label).toBe('Slides');
    expect(getCategoryLabel('software').label).toBe('Software');
    expect(getCategoryLabel('custom').label).toBe('Custom');
  });

  it('returns custom label for unknown category', () => {
    // Cast to bypass type safety to test fallback
    expect(getCategoryLabel('unknown' as 'custom').label).toBe('Custom');
  });
});

describe('CATEGORY_LABELS', () => {
  it('contains entries for all official categories plus custom', () => {
    expect(Object.keys(CATEGORY_LABELS)).toEqual(
      expect.arrayContaining(['research', 'writing', 'planning', 'slides', 'software', 'custom']),
    );
  });
});
