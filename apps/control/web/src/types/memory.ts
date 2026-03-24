export interface Memory {
  id: string;
  space_id: string;
  type: 'episode' | 'semantic' | 'procedural';
  category: string | null;
  content: string;
  summary: string | null;
  importance: number;
  tags: string | null;
  occurred_at: string | null;
  expires_at: string | null;
  last_accessed_at: string | null;
  access_count: number;
  created_at: string;
  updated_at: string;
}

export interface Reminder {
  id: string;
  space_id: string;
  content: string;
  context: string | null;
  trigger_type: 'time' | 'condition' | 'context';
  trigger_value: string | null;
  status: 'pending' | 'triggered' | 'completed' | 'dismissed';
  triggered_at?: string | null;
  priority: 'low' | 'normal' | 'high' | 'critical';
  created_at: string;
  updated_at: string;
}
