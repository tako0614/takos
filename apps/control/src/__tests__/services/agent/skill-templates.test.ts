import { describe, expect, it } from 'vitest';

import {
  listSkillTemplates,
  hasSkillTemplate,
  type SkillTemplateDefinition,
} from '@/services/agent/skill-templates';

describe('listSkillTemplates', () => {
  it('returns all official skill templates', () => {
    const templates = listSkillTemplates();
    expect(templates.length).toBe(7);
    const ids = templates.map((t) => t.id);
    expect(ids).toEqual([
      'research-brief',
      'writing-draft',
      'planning-structurer',
      'slides-outline',
      'speaker-notes',
      'repo-app-bootstrap',
      'api-worker',
    ]);
  });

  it('each template has required fields', () => {
    const templates = listSkillTemplates();
    for (const template of templates) {
      expect(template.id).toBeTruthy();
      expect(template.title).toBeTruthy();
      expect(template.description).toBeTruthy();
    }
  });

  it('returns a copy, not the original array', () => {
    const first = listSkillTemplates();
    const second = listSkillTemplates();
    first[0].title = 'MODIFIED';
    expect(second[0].title).not.toBe('MODIFIED');
  });

  it('returns templates with correct properties', () => {
    const templates = listSkillTemplates();
    const researchBrief = templates.find((t) => t.id === 'research-brief');
    expect(researchBrief).toBeDefined();
    expect(researchBrief!.title).toBe('Research Brief');
    expect(researchBrief!.description).toContain('research');

    const apiWorker = templates.find((t) => t.id === 'api-worker');
    expect(apiWorker).toBeDefined();
    expect(apiWorker!.title).toBe('API Worker');
  });
});

describe('hasSkillTemplate', () => {
  it('returns true for all known template IDs', () => {
    expect(hasSkillTemplate('research-brief')).toBe(true);
    expect(hasSkillTemplate('writing-draft')).toBe(true);
    expect(hasSkillTemplate('planning-structurer')).toBe(true);
    expect(hasSkillTemplate('slides-outline')).toBe(true);
    expect(hasSkillTemplate('speaker-notes')).toBe(true);
    expect(hasSkillTemplate('repo-app-bootstrap')).toBe(true);
    expect(hasSkillTemplate('api-worker')).toBe(true);
  });

  it('returns false for unknown template IDs', () => {
    expect(hasSkillTemplate('nonexistent')).toBe(false);
    expect(hasSkillTemplate('')).toBe(false);
    expect(hasSkillTemplate('RESEARCH-BRIEF')).toBe(false); // case-sensitive
  });
});
