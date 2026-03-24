export interface Skill {
  id: string;
  name: string;
  description: string | null;
  instructions: string;
  triggers: string[];
  metadata?: {
    locale?: 'ja' | 'en';
    category?: 'research' | 'writing' | 'planning' | 'slides' | 'software';
    activation_tags?: string[];
    execution_contract?: {
      preferred_tools?: string[];
      durable_output_hints?: string[];
      output_modes?: string[];
      required_mcp_servers?: string[];
      template_ids?: string[];
    };
  };
  source: 'custom';
  editable: true;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface OfficialSkill {
  id: string;
  version?: string;
  name: string;
  description: string;
  triggers: string[];
  source: 'official';
  editable: false;
  enabled: boolean;
  category: string;
  locale: 'ja' | 'en';
  availability?: 'available' | 'warning' | 'unavailable';
  availability_reasons?: string[];
  activation_tags?: string[];
  execution_contract?: {
    preferred_tools?: string[];
    durable_output_hints?: string[];
    output_modes?: string[];
    required_mcp_servers?: string[];
    template_ids?: string[];
  };
}
