import type { SkillResourceManifestEntry } from "../services/agent/skill-revisions.ts";

export type CapabilityKind = "tool" | "skill";

export type CapabilityNamespace =
  | "container"
  | "repo"
  | "file"
  | "deploy"
  | "platform"
  | "runtime"
  | "storage"
  | "chat.attachments"
  | "space.files"
  | "space.env"
  | "space.skills"
  | "workspace.skills"
  | "space.apps"
  | "space.source"
  | "catalog"
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
  recommended_tools?: string[];
  output_modes?: string[];
  durable_output_hints?: string[];
  /** Bounded metadata only; resource content requires exact Run activation. */
  resource_manifest?: SkillResourceManifestEntry[];
  tags: string[];
  triggers?: string[];
  /** Worker-internal logical identity for an immutable pinned manual. */
  manual_identity?: {
    source: "managed" | "custom";
    skill_id: string;
  };
  availability?: "available" | "warning" | "unavailable";
  availability_reasons?: string[];
  family?: string;
  risk_level: RiskLevel;
  side_effects: boolean;
  required_capabilities?: string[];
  source: "custom" | "mcp" | "managed_skill" | "custom_skill";
  discoverable: boolean;
  selectable: boolean;
}
