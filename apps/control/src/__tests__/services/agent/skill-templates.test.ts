import {
  listSkillTemplates,
  hasSkillTemplate,
  type SkillTemplateDefinition,
} from '@/services/agent/skill-templates';


import { assertEquals, assertNotEquals, assert, assertStringIncludes } from 'jsr:@std/assert';

  Deno.test('listSkillTemplates - returns all official skill templates', () => {
  const templates = listSkillTemplates();
    assertEquals(templates.length, 7);
    const ids = templates.map((t) => t.id);
    assertEquals(ids, [
      'research-brief',
      'writing-draft',
      'planning-structurer',
      'slides-outline',
      'speaker-notes',
      'repo-app-bootstrap',
      'api-worker',
    ]);
})
  Deno.test('listSkillTemplates - each template has required fields', () => {
  const templates = listSkillTemplates();
    for (const template of templates) {
      assert(template.id);
      assert(template.title);
      assert(template.description);
    }
})
  Deno.test('listSkillTemplates - returns a copy, not the original array', () => {
  const first = listSkillTemplates();
    const second = listSkillTemplates();
    first[0].title = 'MODIFIED';
    assertNotEquals(second[0].title, 'MODIFIED');
})
  Deno.test('listSkillTemplates - returns templates with correct properties', () => {
  const templates = listSkillTemplates();
    const researchBrief = templates.find((t) => t.id === 'research-brief');
    assert(researchBrief !== undefined);
    assertEquals(researchBrief!.title, 'Research Brief');
    assertStringIncludes(researchBrief!.description, 'research');

    const apiWorker = templates.find((t) => t.id === 'api-worker');
    assert(apiWorker !== undefined);
    assertEquals(apiWorker!.title, 'API Worker');
})

  Deno.test('hasSkillTemplate - returns true for all known template IDs', () => {
  assertEquals(hasSkillTemplate('research-brief'), true);
    assertEquals(hasSkillTemplate('writing-draft'), true);
    assertEquals(hasSkillTemplate('planning-structurer'), true);
    assertEquals(hasSkillTemplate('slides-outline'), true);
    assertEquals(hasSkillTemplate('speaker-notes'), true);
    assertEquals(hasSkillTemplate('repo-app-bootstrap'), true);
    assertEquals(hasSkillTemplate('api-worker'), true);
})
  Deno.test('hasSkillTemplate - returns false for unknown template IDs', () => {
  assertEquals(hasSkillTemplate('nonexistent'), false);
    assertEquals(hasSkillTemplate(''), false);
    assertEquals(hasSkillTemplate('RESEARCH-BRIEF'), false); // case-sensitive
})