export interface Workspace {
  id?: string;
  slug: string;
  name: string;
  description: string | null;
  kind: 'user' | 'team' | 'system';
  owner_principal_id?: string | null;
  automation_principal_id?: string | null;
  security_posture?: 'standard' | 'restricted_egress';
  is_personal?: boolean;
  created_at: string;
  updated_at: string;
}
