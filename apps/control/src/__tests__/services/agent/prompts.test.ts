import { describe, expect, it } from 'vitest';

import { buildAvailableToolsPrompt, DEFAULT_CORE_PROMPT, SYSTEM_PROMPTS } from '@/services/agent/prompts';

describe('agent prompts', () => {
  it('keeps the default prompt focused on task completion with tool use', () => {
    expect(DEFAULT_CORE_PROMPT).toContain("You are Takos's universal agent.");
    expect(DEFAULT_CORE_PROMPT).toContain('Only use tools that are explicitly listed');
    expect(DEFAULT_CORE_PROMPT).toContain('keep moving until the task is actually complete');
    expect(DEFAULT_CORE_PROMPT).toContain('Default to spawning sub-agents');
    expect(DEFAULT_CORE_PROMPT).toContain('Infer the target product from thread context');
    expect(SYSTEM_PROMPTS.default).toContain('built-in official skills');
    expect(SYSTEM_PROMPTS.default).toContain('Treat the request as work to complete');
    expect(SYSTEM_PROMPTS.default).toContain('spawn sub-agents early');
    expect(SYSTEM_PROMPTS.default).toContain('infer it from the thread, docs, and repo context first');
  });

  it('injects only the runtime-available tool catalog', () => {
    const prompt = buildAvailableToolsPrompt(SYSTEM_PROMPTS.default, [
      { name: 'capability_search', description: 'Search tools by capability' },
      { name: 'wait_agent', description: 'Wait for a child run' },
      { name: 'workspace_files_read', description: 'Read a workspace file' },
    ]);

    expect(prompt).toContain('`capability_search`');
    expect(prompt).toContain('`wait_agent`');
    expect(prompt).toContain('`workspace_files_read`');
    expect(prompt).toContain('If you are unsure which tool fits');
    expect(prompt).not.toContain('`web_search`');
  });

  it('keeps specialized prompts focused without hardcoding tool inventories', () => {
    expect(SYSTEM_PROMPTS.implementer).toContain('## Implementation Mode');
    expect(SYSTEM_PROMPTS.reviewer).toContain('## Review Mode');
    expect(SYSTEM_PROMPTS.implementer).not.toContain('`web_search`');
    expect(SYSTEM_PROMPTS.implementer).not.toContain('`container_start`');
  });

  it('keeps assistant and planner as thin universal specializations', () => {
    expect(SYSTEM_PROMPTS.assistant).toContain("You are Takos's universal agent.");
    expect(SYSTEM_PROMPTS.assistant).toContain('## Assistant Mode');
    expect(SYSTEM_PROMPTS.planner).toContain("You are Takos's universal agent.");
    expect(SYSTEM_PROMPTS.planner).toContain('## Planning Mode');
    expect(SYSTEM_PROMPTS.assistant).toContain('follow-through');
    expect(SYSTEM_PROMPTS.planner).toContain('decision-ready outputs');
  });
});
