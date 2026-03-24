/**
 * Prompt Budget Manager
 *
 * Manages system prompt composition with priority-based budget allocation.
 * Prevents unbounded prompt growth that degrades first-token latency.
 */

/** CJK Unicode ranges for accurate token estimation */
const CJK_REGEX = /[\u3000-\u9fff\uf900-\ufaff\ufe30-\ufe4f]/g;
const WORD_BOUNDARY_REGEX = /[\s,.;:!?()\[\]{}"'`\-/\\|<>+=*&^%$#@~]+/;

/**
 * Estimate token count for a text string.
 * More accurate than simple char/4 division:
 * - Splits on word/punctuation boundaries
 * - Counts CJK characters individually (each is typically 1-2 tokens)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // Count CJK characters (each is roughly 1 token)
  const cjkMatches = text.match(CJK_REGEX);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;

  // Remove CJK characters and count remaining words
  const nonCjk = text.replace(CJK_REGEX, ' ');
  const words = nonCjk.split(WORD_BOUNDARY_REGEX).filter(w => w.length > 0);

  // Each word is roughly 1.3 tokens on average (subword tokenization)
  const wordTokens = Math.ceil(words.length * 1.3);

  return cjkCount + wordTokens;
}

export interface PromptLane {
  /** Priority: lower number = higher priority (P0 is highest) */
  priority: number;
  /** Lane identifier for debugging */
  name: string;
  /** Content for this lane */
  content: string;
  /** Maximum tokens for this lane */
  maxTokens: number;
}

export interface PromptBudgetConfig {
  /** Total token budget for the system prompt. Default: 8000 */
  totalBudget?: number;
}

const DEFAULT_TOTAL_BUDGET = 8000;

/**
 * Build a budgeted system prompt from priority lanes.
 * Lanes are placed in priority order. When the total budget is exceeded,
 * lower-priority lanes are truncated or dropped.
 */
export function buildBudgetedSystemPrompt(
  lanes: PromptLane[],
  config?: PromptBudgetConfig,
): string {
  const totalBudget = config?.totalBudget ?? DEFAULT_TOTAL_BUDGET;

  // Sort by priority (lower number = higher priority)
  const sorted = [...lanes].filter(l => l.content.length > 0).sort((a, b) => a.priority - b.priority);

  const parts: string[] = [];
  let usedTokens = 0;

  for (const lane of sorted) {
    const remaining = totalBudget - usedTokens;
    if (remaining <= 0) break;

    const laneTokens = estimateTokens(lane.content);
    const laneBudget = Math.min(lane.maxTokens, remaining);

    if (laneTokens <= laneBudget) {
      // Fits within budget
      parts.push(lane.content);
      usedTokens += laneTokens;
    } else {
      // Truncate to fit
      const truncated = truncateToTokenBudget(lane.content, laneBudget);
      if (truncated) {
        parts.push(truncated);
        usedTokens += estimateTokens(truncated);
      }
    }
  }

  return parts.join('\n\n');
}

/**
 * Truncate text to approximately fit within a token budget.
 * Tries to break at paragraph or sentence boundaries.
 */
function truncateToTokenBudget(text: string, budget: number): string {
  if (budget <= 0) return '';

  const tokens = estimateTokens(text);
  if (tokens <= budget) return text;

  // Estimate character ratio
  const ratio = budget / tokens;
  const targetChars = Math.floor(text.length * ratio);

  // Try to break at paragraph boundary
  const paragraphs = text.split('\n\n');
  let result = '';
  for (const para of paragraphs) {
    if (estimateTokens(result + para) > budget) break;
    result += (result ? '\n\n' : '') + para;
  }

  if (result) {
    return result + '\n\n[... truncated]';
  }

  // Fallback: hard cut at target chars
  return text.slice(0, targetChars) + '\n\n[... truncated]';
}

/** Standard lane priorities */
export const LANE_PRIORITY = {
  BASE_PROMPT: 0,
  TOOL_CATALOG: 1,
  MEMORY_ACTIVATION: 2,
  SKILL_INSTRUCTIONS: 3,
  THREAD_CONTEXT: 4,
} as const;

/** Standard lane max tokens */
export const LANE_MAX_TOKENS = {
  BASE_PROMPT: 2000,
  TOOL_CATALOG: 2500,
  MEMORY_ACTIVATION: 800,
  SKILL_INSTRUCTIONS: 2000,
  THREAD_CONTEXT: 1500,
} as const;
