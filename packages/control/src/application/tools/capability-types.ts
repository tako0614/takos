import type { SpaceRole } from "../../shared/types/index.ts";

export type CapabilityKind = "tool" | "skill";

export type CapabilityNamespace =
  | "container"
  | "repo"
  | "file"
  | "deploy"
  | "platform"
  | "runtime"
  | "storage"
  | "space.files"
  | "space.env"
  | "space.skills"
  | "space.apps"
  | "space.groups.deployments"
  | "space.source"
  | "memory"
  | "web"
  | "artifact"
  | "agent"
  | "mcp"
  | "discovery";

export type RiskLevel = "none" | "low" | "medium" | "high";

export interface CapabilityDescriptor {
  id: string;
  kind: CapabilityKind;
  namespace: CapabilityNamespace;
  name: string;
  summary: string;
  instructions?: string;
  recommended_tools?: string[];
  output_modes?: string[];
  durable_output_hints?: string[];
  tags: string[];
  triggers?: string[];
  family?: string;
  risk_level: RiskLevel;
  side_effects: boolean;
  required_roles?: SpaceRole[];
  required_capabilities?: string[];
  source: "custom" | "mcp" | "managed_skill" | "custom_skill";
  discoverable: boolean;
  selectable: boolean;
}
