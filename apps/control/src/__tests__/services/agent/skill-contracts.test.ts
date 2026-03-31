import type {
  SkillLocale,
  OfficialSkillCategory,
  SkillCategory,
  DurableOutputHint,
  SkillOutputMode,
  SkillSource,
  SkillExecutionContract,
  CustomSkillMetadata,
} from '@/services/agent/skill-contracts';


import { assertEquals, assertStringIncludes } from 'jsr:@std/assert';

  Deno.test('skill-contracts type definitions - SkillLocale accepts ja and en', () => {
  const ja: SkillLocale = 'ja';
    const en: SkillLocale = 'en';
    assertEquals(ja, 'ja');
    assertEquals(en, 'en');
})
  Deno.test('skill-contracts type definitions - OfficialSkillCategory covers all expected values', () => {
  const categories: OfficialSkillCategory[] = ['research', 'writing', 'planning', 'slides', 'software'];
    assertEquals(categories.length, 5);
})
  Deno.test('skill-contracts type definitions - SkillCategory extends OfficialSkillCategory with custom', () => {
  const custom: SkillCategory = 'custom';
    assertEquals(custom, 'custom');
})
  Deno.test('skill-contracts type definitions - DurableOutputHint covers expected values', () => {
  const hints: DurableOutputHint[] = ['artifact', 'reminder', 'repo', 'app', 'workspace_file'];
    assertEquals(hints.length, 5);
})
  Deno.test('skill-contracts type definitions - SkillOutputMode includes chat and all durable hints', () => {
  const modes: SkillOutputMode[] = ['chat', 'artifact', 'reminder', 'repo', 'app', 'workspace_file'];
    assertEquals(modes.length, 6);
    assertStringIncludes(modes, 'chat');
})
  Deno.test('skill-contracts type definitions - SkillSource accepts official and custom', () => {
  const sources: SkillSource[] = ['official', 'custom'];
    assertEquals(sources.length, 2);
})
  Deno.test('skill-contracts type definitions - SkillExecutionContract has required fields', () => {
  const contract: SkillExecutionContract = {
      preferred_tools: ['tool1'],
      durable_output_hints: ['artifact'],
      output_modes: ['chat', 'artifact'],
      required_mcp_servers: ['server1'],
      template_ids: ['template1'],
    };

    assertEquals(contract.preferred_tools, ['tool1']);
    assertEquals(contract.durable_output_hints, ['artifact']);
    assertEquals(contract.output_modes, ['chat', 'artifact']);
    assertEquals(contract.required_mcp_servers, ['server1']);
    assertEquals(contract.template_ids, ['template1']);
})
  Deno.test('skill-contracts type definitions - CustomSkillMetadata allows all optional fields', () => {
  const meta: CustomSkillMetadata = {
      locale: 'ja',
      category: 'research',
      activation_tags: ['tag1'],
      execution_contract: {
        preferred_tools: ['tool'],
        output_modes: ['chat'],
      },
    };

    assertEquals(meta.locale, 'ja');
    assertEquals(meta.category, 'research');
    assertEquals(meta.activation_tags, ['tag1']);
    assertEquals(meta.execution_contract?.preferred_tools, ['tool']);
})
  Deno.test('skill-contracts type definitions - CustomSkillMetadata allows empty object', () => {
  const meta: CustomSkillMetadata = {};
    assertEquals(meta.locale, undefined);
    assertEquals(meta.category, undefined);
    assertEquals(meta.activation_tags, undefined);
    assertEquals(meta.execution_contract, undefined);
})