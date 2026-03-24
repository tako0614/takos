export type SkillLocale = 'ja' | 'en';
export type OfficialSkillCategory = 'research' | 'writing' | 'planning' | 'slides' | 'software';
export type SkillCategory = OfficialSkillCategory | 'custom';
export type DurableOutputHint = 'artifact' | 'reminder' | 'repo' | 'app' | 'workspace_file';
export type SkillOutputMode = 'chat' | DurableOutputHint;
export type SkillSource = 'official' | 'custom';

export interface SkillExecutionContract {
  preferred_tools: string[];
  durable_output_hints: DurableOutputHint[];
  output_modes: SkillOutputMode[];
  required_mcp_servers: string[];
  template_ids: string[];
}

export interface CustomSkillMetadata {
  locale?: SkillLocale;
  category?: OfficialSkillCategory;
  activation_tags?: string[];
  execution_contract?: Partial<SkillExecutionContract>;
}
