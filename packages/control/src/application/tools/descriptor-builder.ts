import type { ToolDefinition } from './tool-definitions.ts';
import type {
  CapabilityDescriptor,
  CapabilityNamespace,
} from './capability-types.ts';
import type { LocalizedOfficialSkill } from '../services/agent/official-skills.ts';
import { TOOL_NAMESPACE_MAP } from './namespace-map.ts';

/** Derive tags from a tool's category + namespace metadata. */
function deriveToolTags(tool: ToolDefinition): string[] {
  const tags: string[] = [tool.category];
  const meta = TOOL_NAMESPACE_MAP[tool.name];
  if (meta) {
    tags.push(meta.namespace);
    if (meta.family) tags.push(meta.family);
  }
  if (tool.required_capabilities) {
    tags.push(...tool.required_capabilities);
  }
  return [...new Set(tags)];
}

export function applyPolicyForRole(
  descriptors: CapabilityDescriptor[],
  role?: string,
  capabilities?: string[],
): CapabilityDescriptor[] {
  return descriptors.map(d => {
    let { discoverable, selectable } = d;

    if (role === 'viewer' && d.risk_level === 'high') {
      discoverable = false;
      selectable = false;
    }

    if (capabilities && !capabilities.includes('egress.http')) {
      if (d.namespace === 'web' || d.namespace === 'browser') {
        selectable = false;
      }
    }

    return { ...d, discoverable, selectable };
  });
}

/** Convert a ToolDefinition to a CapabilityDescriptor. */
export function buildToolDescriptor(tool: ToolDefinition): CapabilityDescriptor {
  const meta = TOOL_NAMESPACE_MAP[tool.name];

  const namespace = (tool.namespace as CapabilityNamespace | undefined)
    ?? meta?.namespace
    ?? (tool.category as CapabilityNamespace);
  const family = tool.family ?? meta?.family;
  const risk_level = tool.risk_level
    ?? meta?.risk_level
    ?? 'none';
  const side_effects = tool.side_effects
    ?? meta?.side_effects
    ?? false;

  return {
    id: `tool:${tool.name}`,
    kind: 'tool',
    namespace,
    name: tool.name,
    summary: tool.description,
    tags: deriveToolTags(tool),
    family,
    risk_level,
    side_effects,
    required_roles: tool.required_roles,
    required_capabilities: tool.required_capabilities,
    source: 'builtin',
    discoverable: true,
    selectable: true,
  };
}

/** Convert a LocalizedOfficialSkill to a CapabilityDescriptor. */
export function buildSkillDescriptor(skill: LocalizedOfficialSkill): CapabilityDescriptor {
  return {
    id: `skill:${skill.id}`,
    kind: 'skill',
    namespace: categoryToNamespace(skill.category),
    name: skill.name ?? skill.id,
    summary: skill.description ?? '',
    tags: [skill.category, ...(skill.triggers ?? []).slice(0, 5)],
    triggers: skill.triggers ?? [],
    family: `skill.${skill.category}`,
    risk_level: 'none',
    side_effects: false,
    source: 'official_skill',
    discoverable: true,
    selectable: true,
  };
}

/** Convert a custom skill row (minimal shape) to a CapabilityDescriptor. */
export function buildCustomSkillDescriptor(skill: {
  id: string;
  name: string;
  description: string;
  triggers?: string[];
  category?: string;
}): CapabilityDescriptor {
  const triggers = skill.triggers ?? [];
  return {
    id: `skill:${skill.id}`,
    kind: 'skill',
    namespace: categoryToNamespace(skill.category),
    name: skill.name,
    summary: skill.description,
    tags: [skill.category ?? 'custom', ...triggers.slice(0, 5)],
    triggers,
    family: `skill.${skill.category ?? 'custom'}`,
    risk_level: 'none',
    side_effects: false,
    source: 'custom_skill',
    discoverable: true,
    selectable: true,
  };
}

export interface McpToolMeta {
  serverName: string;
  sourceType: 'managed' | 'external';
}

/** Max length for MCP tool descriptions to prevent prompt pollution / injection. */
const MAX_MCP_SUMMARY_LENGTH = 500;
const MAX_MCP_NAME_LENGTH = 100;

/** Sanitize untrusted MCP metadata to prevent prompt injection. */
function sanitizeMcpString(s: string, maxLen: number): string {
  let sanitized = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0x00 && code <= 0x1f) continue;
    sanitized += s[i];
  }
  return sanitized.trim().slice(0, maxLen);
}

/** Build a descriptor for MCP-sourced tools. */
export function buildMcpToolDescriptor(
  tool: ToolDefinition,
  meta?: McpToolMeta,
): CapabilityDescriptor {
  const rawServer = meta?.serverName ?? inferServerName(tool.name);
  const isManaged = meta?.sourceType === 'managed';
  const safeName = sanitizeMcpString(tool.name, MAX_MCP_NAME_LENGTH);
  const safeServer = sanitizeMcpString(rawServer, 50);

  return {
    id: `tool:${safeName}`,
    kind: 'tool',
    namespace: 'mcp',
    name: safeName,
    summary: sanitizeMcpString(tool.description, MAX_MCP_SUMMARY_LENGTH),
    tags: ['mcp', `mcp.${safeServer}`, tool.category],
    family: `mcp.${safeServer}`,
    risk_level: isManaged ? 'low' : 'medium',
    side_effects: true,
    required_roles: tool.required_roles,
    required_capabilities: tool.required_capabilities,
    source: 'mcp',
    discoverable: true,
    selectable: true,
  };
}

/**
 * Infer server name from namespaced tool name pattern `servername__toolname`.
 * Falls back to 'external' if no prefix detected.
 */
function inferServerName(toolName: string): string {
  const idx = toolName.indexOf('__');
  return idx > 0 ? toolName.slice(0, idx) : 'external';
}

function categoryToNamespace(category?: string): CapabilityNamespace {
  switch (category) {
    case 'research': return 'web';
    case 'writing':
    case 'planning':
    case 'slides': return 'artifact';
    case 'software': return 'repo';
    default: return 'discovery';
  }
}
