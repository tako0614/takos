import { describe, expect, it } from 'vitest';

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

describe('skill-contracts type definitions', () => {
  it('SkillLocale accepts ja and en', () => {
    const ja: SkillLocale = 'ja';
    const en: SkillLocale = 'en';
    expect(ja).toBe('ja');
    expect(en).toBe('en');
  });

  it('OfficialSkillCategory covers all expected values', () => {
    const categories: OfficialSkillCategory[] = ['research', 'writing', 'planning', 'slides', 'software'];
    expect(categories).toHaveLength(5);
  });

  it('SkillCategory extends OfficialSkillCategory with custom', () => {
    const custom: SkillCategory = 'custom';
    expect(custom).toBe('custom');
  });

  it('DurableOutputHint covers expected values', () => {
    const hints: DurableOutputHint[] = ['artifact', 'reminder', 'repo', 'app', 'workspace_file'];
    expect(hints).toHaveLength(5);
  });

  it('SkillOutputMode includes chat and all durable hints', () => {
    const modes: SkillOutputMode[] = ['chat', 'artifact', 'reminder', 'repo', 'app', 'workspace_file'];
    expect(modes).toHaveLength(6);
    expect(modes).toContain('chat');
  });

  it('SkillSource accepts official and custom', () => {
    const sources: SkillSource[] = ['official', 'custom'];
    expect(sources).toHaveLength(2);
  });

  it('SkillExecutionContract has required fields', () => {
    const contract: SkillExecutionContract = {
      preferred_tools: ['tool1'],
      durable_output_hints: ['artifact'],
      output_modes: ['chat', 'artifact'],
      required_mcp_servers: ['server1'],
      template_ids: ['template1'],
    };

    expect(contract.preferred_tools).toEqual(['tool1']);
    expect(contract.durable_output_hints).toEqual(['artifact']);
    expect(contract.output_modes).toEqual(['chat', 'artifact']);
    expect(contract.required_mcp_servers).toEqual(['server1']);
    expect(contract.template_ids).toEqual(['template1']);
  });

  it('CustomSkillMetadata allows all optional fields', () => {
    const meta: CustomSkillMetadata = {
      locale: 'ja',
      category: 'research',
      activation_tags: ['tag1'],
      execution_contract: {
        preferred_tools: ['tool'],
        output_modes: ['chat'],
      },
    };

    expect(meta.locale).toBe('ja');
    expect(meta.category).toBe('research');
    expect(meta.activation_tags).toEqual(['tag1']);
    expect(meta.execution_contract?.preferred_tools).toEqual(['tool']);
  });

  it('CustomSkillMetadata allows empty object', () => {
    const meta: CustomSkillMetadata = {};
    expect(meta.locale).toBeUndefined();
    expect(meta.category).toBeUndefined();
    expect(meta.activation_tags).toBeUndefined();
    expect(meta.execution_contract).toBeUndefined();
  });
});
