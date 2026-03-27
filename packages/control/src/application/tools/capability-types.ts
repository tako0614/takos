import type { SpaceRole } from '../../shared/types';

export type CapabilityKind = 'tool' | 'skill';

export type CapabilityNamespace =
  | 'container'
  | 'repo'
  | 'file'
  | 'deploy'
  | 'platform'
  | 'runtime'
  | 'storage'
  | 'workspace.files'
  | 'workspace.env'
  | 'workspace.skills'
  | 'workspace.apps'
  | 'workspace.source'
  | 'memory'
  | 'web'
  | 'artifact'
  | 'agent'
  | 'mcp'
  | 'browser'
  | 'discovery';

export type RiskLevel = 'none' | 'low' | 'medium' | 'high';

export interface CapabilityDescriptor {
  id: string;
  kind: CapabilityKind;
  namespace: CapabilityNamespace;
  name: string;
  summary: string;
  tags: string[];
  triggers?: string[];
  family?: string;
  risk_level: RiskLevel;
  side_effects: boolean;
  required_roles?: SpaceRole[];
  required_capabilities?: string[];
  source: 'builtin' | 'mcp' | 'official_skill' | 'custom_skill';
  discoverable: boolean;
  selectable: boolean;
}
