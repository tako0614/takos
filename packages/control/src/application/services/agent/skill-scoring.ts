/**
 * Skill Scoring and Matching Utilities.
 *
 * Contains tokenization, phrase matching, context segment extraction,
 * category/output-mode keyword maps, and the core skill scoring algorithm.
 *
 * Extracted from skills.ts to separate scoring concerns from
 * skill resolution and loading.
 */

import type {
  SkillCategory,
  SkillExecutionContract,
} from './skill-contracts.ts';
import type { SkillContext, SkillSelection, SkillResolutionContext } from './skill-resolution.ts';
import { getDelegationPacketFromRunInput } from './delegation.ts';

// ── Constants ───────────────────────────────────────────────────────────

export const CONVERSATION_WINDOW = 8;
export const MESSAGE_RECENCY_WEIGHTS = [1.3, 1.1, 0.95, 0.8, 0.6, 0.45, 0.35, 0.25];

const MAX_SELECTED_SKILLS_PER_RUN = 8;

export const DEFAULT_EXECUTION_CONTRACT: SkillExecutionContract = {
  preferred_tools: [],
  durable_output_hints: [],
  output_modes: ['chat'],
  required_mcp_servers: [],
  template_ids: [],
};

// ── Internal helpers ────────────────────────────────────────────────────

export function cloneExecutionContract(contract?: Partial<SkillExecutionContract> | null): SkillExecutionContract {
  return {
    preferred_tools: [...(contract?.preferred_tools ?? DEFAULT_EXECUTION_CONTRACT.preferred_tools)],
    durable_output_hints: [...(contract?.durable_output_hints ?? DEFAULT_EXECUTION_CONTRACT.durable_output_hints)],
    output_modes: [...(contract?.output_modes ?? DEFAULT_EXECUTION_CONTRACT.output_modes)],
    required_mcp_servers: [...(contract?.required_mcp_servers ?? DEFAULT_EXECUTION_CONTRACT.required_mcp_servers)],
    template_ids: [...(contract?.template_ids ?? DEFAULT_EXECUTION_CONTRACT.template_ids)],
  };
}

// ── Tokenization ────────────────────────────────────────────────────────

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

// ── Phrase matching ─────────────────────────────────────────────────────

export function matchesPhrase(text: string, phrase: string): boolean {
  const normalizedText = text.toLowerCase();
  const normalizedPhrase = phrase.toLowerCase().trim();
  if (!normalizedPhrase) {
    return false;
  }
  if (normalizedText.includes(normalizedPhrase)) {
    return true;
  }
  const textTokens = new Set(tokenize(normalizedText));
  const phraseTokens = tokenize(normalizedPhrase);
  if (phraseTokens.length === 0) {
    return false;
  }
  return phraseTokens.every((token) => textTokens.has(token));
}

// ── Context segment extraction ──────────────────────────────────────────

export function getContextSegments(input: SkillResolutionContext): Array<{ label: string; text: string; weight: number }> {
  const segments: Array<{ label: string; text: string; weight: number }> = [];
  const recentMessages = input.conversation
    .map((message) => message.trim())
    .filter(Boolean)
    .slice(-CONVERSATION_WINDOW)
    .reverse();

  recentMessages.forEach((message, index) => {
    segments.push({
      label: index === 0 ? 'latest message' : `recent message ${index + 1}`,
      text: message,
      weight: MESSAGE_RECENCY_WEIGHTS[index] ?? 0.15,
    });
  });

  if (input.threadTitle?.trim()) {
    segments.push({ label: 'thread title', text: input.threadTitle.trim(), weight: 1.15 });
  }
  if (input.threadSummary?.trim()) {
    segments.push({ label: 'thread summary', text: input.threadSummary.trim(), weight: 0.9 });
  }
  for (const [index, keyPoint] of (input.threadKeyPoints ?? []).map((item) => item.trim()).filter(Boolean).slice(0, 8).entries()) {
    segments.push({ label: `thread key point ${index + 1}`, text: keyPoint, weight: 0.7 });
  }

  const runInput = input.runInput ?? {};
  for (const fieldName of ['task', 'goal', 'prompt', 'title', 'description']) {
    const value = runInput[fieldName];
    if (typeof value === 'string' && value.trim()) {
      segments.push({ label: `run input ${fieldName}`, text: value.trim(), weight: 1.2 });
    }
  }

  const delegation = getDelegationPacketFromRunInput(runInput);
  if (delegation) {
    segments.push({ label: 'delegation task', text: delegation.task, weight: 1.35 });
    if (delegation.goal) {
      segments.push({ label: 'delegation goal', text: delegation.goal, weight: 1.15 });
    }
    if (delegation.deliverable) {
      segments.push({ label: 'delegation deliverable', text: delegation.deliverable, weight: 1.0 });
    }
    if (delegation.product_hint) {
      segments.push({ label: 'delegation product hint', text: delegation.product_hint, weight: 0.95 });
    }
    for (const [index, item] of delegation.context.slice(0, 6).entries()) {
      segments.push({ label: `delegation context ${index + 1}`, text: item, weight: 0.9 });
    }
    for (const [index, item] of delegation.acceptance_criteria.slice(0, 4).entries()) {
      segments.push({ label: `delegation acceptance ${index + 1}`, text: item, weight: 0.85 });
    }
  }

  return segments;
}

// ── Category and output-mode keyword maps ───────────────────────────────

export function getCategoryKeywords(): Record<Exclude<SkillCategory, 'custom'>, string[]> {
  return {
    research: ['research', 'investigate', 'compare', 'analysis', 'sources', 'latest', '調査', '比較', '分析', '根拠', '出典'],
    writing: ['write', 'draft', 'rewrite', 'email', 'report', 'article', '文章', '下書き', '書き直し', 'メール', 'レポート'],
    planning: ['plan', 'roadmap', 'milestone', 'organize', 'next steps', '計画', 'ロードマップ', '段取り', '進め方'],
    slides: ['slides', 'deck', 'presentation', 'pptx', 'スライド', 'プレゼン', '資料', 'パワポ'],
    software: ['repo', 'repository', 'api', 'deploy', 'tool', 'automation', 'app', 'worker', 'コード', '実装', 'リポジトリ', 'デプロイ', '自動化'],
  };
}

export function getOutputModeKeywords(): Record<string, string[]> {
  return {
    artifact: ['artifact', 'document', 'doc', '保存', '残す', '文書', '成果物'],
    reminder: ['reminder', 'follow up', 'deadline', '通知', 'リマインド', 'フォローアップ'],
    repo: ['repo', 'repository', 'git', 'リポジトリ', 'git'],
    app: ['deploy', 'publish', 'app', 'service', '公開', 'デプロイ', 'サービス'],
    workspace_file: ['file', 'pptx', 'slides', 'ファイル', '資料', 'pptx'],
  };
}

// ── Scoring ─────────────────────────────────────────────────────────────

export function scoreSkill(skill: SkillContext, input: SkillResolutionContext): SkillSelection | null {
  const segments = getContextSegments(input);
  if (segments.length === 0) {
    return null;
  }

  const reasons = new Set<string>();
  let score = 0;

  for (const segment of segments) {
    for (const trigger of skill.triggers) {
      if (matchesPhrase(segment.text, trigger)) {
        score += 12 * segment.weight;
        reasons.add(`${segment.label} matched trigger "${trigger}"`);
      }
    }

    if (matchesPhrase(segment.text, skill.name)) {
      score += 8 * segment.weight;
      reasons.add(`${segment.label} matched skill name`);
    }

    for (const tag of skill.activation_tags ?? []) {
      if (matchesPhrase(segment.text, tag)) {
        score += 5 * segment.weight;
        reasons.add(`${segment.label} matched activation tag "${tag}"`);
      }
    }

    for (const toolName of skill.execution_contract.preferred_tools.slice(0, 8)) {
      if (matchesPhrase(segment.text, toolName)) {
        score += 3 * segment.weight;
        reasons.add(`${segment.label} referenced preferred tool "${toolName}"`);
      }
    }
  }

  if (skill.category && skill.category !== 'custom') {
    const categoryHints = getCategoryKeywords()[skill.category] ?? [];
    if (segments.some((segment) => categoryHints.some((term) => matchesPhrase(segment.text, term)))) {
      score += 6;
      reasons.add(`category hints matched ${skill.category}`);
    }
  }

  for (const outputMode of skill.execution_contract.output_modes) {
    const outputHints = getOutputModeKeywords()[outputMode] ?? [];
    if (segments.some((segment) => outputHints.some((term) => matchesPhrase(segment.text, term)))) {
      score += 4;
      reasons.add(`output intent matched ${outputMode}`);
    }
  }

  const categoryBoosts: Record<string, SkillCategory[]> = {
    researcher: ['research'],
    implementer: ['software'],
    reviewer: ['software'],
    planner: ['planning'],
    assistant: ['writing', 'planning', 'slides', 'research'],
    default: ['software', 'planning', 'research'],
  };
  const boostedCategories = categoryBoosts[input.agentType ?? 'default'] ?? [];
  if (skill.category && boostedCategories.includes(skill.category)) {
    score += 2.5;
    reasons.add(`agent type ${input.agentType ?? 'default'} boosts ${skill.category}`);
  }

  if (score <= 0) {
    return null;
  }

  return {
    skill: {
      ...skill,
      triggers: [...skill.triggers],
      activation_tags: [...(skill.activation_tags ?? [])],
      version: skill.version,
      execution_contract: cloneExecutionContract(skill.execution_contract),
      availability: skill.availability,
      availability_reasons: [...skill.availability_reasons],
      metadata: skill.metadata ? { ...skill.metadata, execution_contract: skill.metadata.execution_contract ? cloneExecutionContract(skill.metadata.execution_contract) : undefined } : undefined,
    },
    score,
    reasons: [...reasons].slice(0, 8),
  };
}

// ── Selection ───────────────────────────────────────────────────────────

export function selectRelevantSkills(
  skills: SkillContext[],
  input: SkillResolutionContext,
): SkillSelection[] {
  return skills
    .filter((skill) => skill.availability !== 'unavailable')
    .map((skill) => scoreSkill(skill, input))
    .filter((entry): entry is SkillSelection => Boolean(entry))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return (b.skill.priority ?? 0) - (a.skill.priority ?? 0);
    })
    .slice(0, input.maxSelected ?? MAX_SELECTED_SKILLS_PER_RUN);
}
