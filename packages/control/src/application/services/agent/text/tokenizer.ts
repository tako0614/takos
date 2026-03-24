/**
 * Text Processing Utilities for Agent Skills.
 *
 * Extracted from skills.ts for reusability across
 * skill scoring, matching, and context extraction.
 */

import type { SkillCategory } from '../skill-contracts';
import { getDelegationPacketFromRunInput } from '../delegation';

// ── Configuration ───────────────────────────────────────────────────────

/**
 * Maximum number of recent conversation messages to consider
 * during skill resolution scoring.
 */
export const CONVERSATION_WINDOW = 8;

/**
 * Recency weights applied to conversation messages in reverse
 * chronological order (index 0 = most recent).
 */
export const MESSAGE_RECENCY_WEIGHTS = [1.3, 1.1, 0.95, 0.8, 0.6, 0.45, 0.35, 0.25];

// ── Tokenization ────────────────────────────────────────────────────────

/**
 * Tokenize text into lowercase tokens of at least 2 characters.
 *
 * Splits on non-alphanumeric boundaries while preserving CJK characters
 * (Hiragana, Katakana, CJK Unified Ideographs).
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

// ── Phrase matching ─────────────────────────────────────────────────────

/**
 * Check whether `text` contains `phrase` either as a direct substring
 * or by matching all phrase tokens against the text's token set.
 *
 * Both values are normalized to lowercase for comparison.
 */
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

/**
 * A weighted text segment used for skill scoring. Each segment carries a
 * human-readable label, the text content, and a numeric weight that
 * reflects its importance in the scoring algorithm.
 */
export interface ContextSegment {
  label: string;
  text: string;
  weight: number;
}

/**
 * Input context used for skill resolution and scoring.
 *
 * Mirrors the shape of `SkillResolutionContext` from skills.ts but only
 * includes the fields required by text processing utilities.
 */
export interface SegmentExtractionInput {
  conversation: string[];
  threadTitle?: string | null;
  threadSummary?: string | null;
  threadKeyPoints?: string[];
  runInput?: Record<string, unknown>;
  agentType?: string;
}

/**
 * Build an array of weighted context segments from conversation history,
 * thread metadata, and run input fields.
 *
 * Recent messages are weighted by recency using `MESSAGE_RECENCY_WEIGHTS`.
 * Thread metadata and run input fields receive fixed weights reflecting
 * their relative importance for skill matching.
 */
export function getContextSegments(input: SegmentExtractionInput): ContextSegment[] {
  const segments: ContextSegment[] = [];
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

/**
 * Return keyword lists for each official skill category.
 *
 * Keywords include both English and Japanese terms used to detect
 * category relevance from conversation context.
 */
export function getCategoryKeywords(): Record<Exclude<SkillCategory, 'custom'>, string[]> {
  return {
    research: ['research', 'investigate', 'compare', 'analysis', 'sources', 'latest', '調査', '比較', '分析', '根拠', '出典'],
    writing: ['write', 'draft', 'rewrite', 'email', 'report', 'article', '文章', '下書き', '書き直し', 'メール', 'レポート'],
    planning: ['plan', 'roadmap', 'milestone', 'organize', 'next steps', '計画', 'ロードマップ', '段取り', '進め方'],
    slides: ['slides', 'deck', 'presentation', 'pptx', 'スライド', 'プレゼン', '資料', 'パワポ'],
    software: ['repo', 'repository', 'api', 'deploy', 'tool', 'automation', 'app', 'worker', 'コード', '実装', 'リポジトリ', 'デプロイ', '自動化'],
  };
}

/**
 * Return keyword lists for each skill output mode.
 *
 * Keywords include both English and Japanese terms used to detect
 * output-mode relevance from conversation context.
 */
export function getOutputModeKeywords(): Record<string, string[]> {
  return {
    artifact: ['artifact', 'document', 'doc', '保存', '残す', '文書', '成果物'],
    reminder: ['reminder', 'follow up', 'deadline', '通知', 'リマインド', 'フォローアップ'],
    repo: ['repo', 'repository', 'git', 'リポジトリ', 'git'],
    app: ['deploy', 'publish', 'app', 'service', '公開', 'デプロイ', 'サービス'],
    workspace_file: ['file', 'pptx', 'slides', 'ファイル', '資料', 'pptx'],
  };
}
