import type { SpaceRole } from '../../shared/types/index.ts';
import type { CapabilityDescriptor } from './capability-types.ts';
import type { CapabilityRegistry } from './capability-registry.ts';

export const DISCOVERY_TOOL_NAMES = new Set(['capability_search', 'capability_families', 'capability_invoke']);

export interface SelectionContext {
  role?: SpaceRole;
  capabilities: string[];
  userQuery: string;
  threadSummary?: string;
  recentToolCalls?: string[];
  sessionState?: {
    hasActiveContainer: boolean;
    hasActiveBrowser: boolean;
  };
  boostedFamilies?: string[];
}

export interface SelectedCapabilities {
  tools: CapabilityDescriptor[];
  skills: CapabilityDescriptor[];
  totalAvailable: number;
}

const DEFAULT_TOP_K_TOOLS = 25;
const DEFAULT_TOP_K_SKILLS = 3;
const MAX_PER_FAMILY = 8;
const FAMILY_BOOST = 30;

type ScoredDescriptor = { descriptor: CapabilityDescriptor; score: number };

export class CandidateSelector {
  private topKTools: number;
  private topKSkills: number;

  constructor(opts?: { topKTools?: number; topKSkills?: number }) {
    this.topKTools = opts?.topKTools ?? DEFAULT_TOP_K_TOOLS;
    this.topKSkills = opts?.topKSkills ?? DEFAULT_TOP_K_SKILLS;
  }

  select(registry: CapabilityRegistry, ctx: SelectionContext): SelectedCapabilities {
    const allDescriptors = registry.all();
    const candidates = allDescriptors.filter(d => this.passesHardFilter(d, ctx));

    const toolCandidates = candidates.filter(d => d.kind === 'tool' && !DISCOVERY_TOOL_NAMES.has(d.name));
    const skillCandidates = candidates.filter(d => d.kind === 'skill');

    const scoredTools = this.scoreAndSort(toolCandidates, ctx);
    const selectedTools = this.applyDiversity(scoredTools, this.topKTools);

    const scoredSkills = this.scoreAndSort(skillCandidates, ctx);
    const selectedSkills = scoredSkills.slice(0, this.topKSkills).map(s => s.descriptor);

    return {
      tools: selectedTools,
      skills: selectedSkills,
      totalAvailable: allDescriptors.length,
    };
  }

  private passesHardFilter(d: CapabilityDescriptor, ctx: SelectionContext): boolean {
    if (!d.selectable) return false;

    if (d.required_roles?.length && ctx.role && !d.required_roles.includes(ctx.role)) {
      return false;
    }

    if (d.required_capabilities?.length && !d.required_capabilities.every(cap => ctx.capabilities.includes(cap))) {
      return false;
    }

    if (ctx.role === 'viewer' && d.risk_level === 'high') return false;

    return true;
  }

  private scoreAndSort(descriptors: CapabilityDescriptor[], ctx: SelectionContext): ScoredDescriptor[] {
    const scored = descriptors.map(d => ({ descriptor: d, score: this.scoreDescriptor(d, ctx) }));
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  private scoreDescriptor(d: CapabilityDescriptor, ctx: SelectionContext): number {
    let score = 0;
    const terms = ctx.userQuery.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 50);

    const nameLower = d.name.toLowerCase();
    const tagsJoined = d.tags.join(' ').toLowerCase();
    const triggersJoined = (d.triggers ?? []).join(' ').toLowerCase();
    const summaryLower = d.summary.toLowerCase();

    for (const term of terms) {
      if (nameLower.includes(term)) score += 30;
      if (tagsJoined.includes(term)) score += 30;
      if (triggersJoined.includes(term)) score += 40;
      if (summaryLower.includes(term)) score += 20;
    }

    if (ctx.sessionState?.hasActiveContainer && (d.namespace === 'file' || d.namespace === 'runtime')) {
      score += 25;
    }
    if (ctx.sessionState?.hasActiveBrowser && d.namespace === 'browser') {
      score += 25;
    }

    if (ctx.recentToolCalls?.includes(d.name)) score += 20;

    if (d.family && ctx.boostedFamilies?.includes(d.family)) score += FAMILY_BOOST;

    return score;
  }

  private applyDiversity(scored: ScoredDescriptor[], limit: number): CapabilityDescriptor[] {
    const result: CapabilityDescriptor[] = [];
    const familyCounts = new Map<string, number>();

    for (const { descriptor } of scored) {
      if (result.length >= limit) break;

      const family = descriptor.family ?? '__none__';
      const count = familyCounts.get(family) ?? 0;
      if (count >= MAX_PER_FAMILY) continue;

      result.push(descriptor);
      familyCounts.set(family, count + 1);
    }

    return result;
  }
}
