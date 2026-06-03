/**
 * Token estimation for conversation-history budgeting.
 */

/** CJK Unicode ranges for accurate token estimation */
const CJK_REGEX = /[　-鿿豈-﫿︰-﹏]/g;
const WORD_BOUNDARY_REGEX = /[\s,.;:!?()\[\]{}"'`\-/\\|<>+=*&^%$#@~]+/;

/**
 * Estimate token count for a text string.
 * More accurate than simple char/4 division:
 * - Splits on word/punctuation boundaries
 * - Counts CJK characters individually (each is typically 1-2 tokens)
 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;

  // Count CJK characters (each is roughly 1 token)
  const cjkMatches = text.match(CJK_REGEX);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;

  // Remove CJK characters and count remaining words
  const nonCjk = text.replace(CJK_REGEX, " ");
  const words = nonCjk.split(WORD_BOUNDARY_REGEX).filter((w) => w.length > 0);

  // Each word is roughly 1.3 tokens on average (subword tokenization)
  const wordTokens = Math.ceil(words.length * 1.3);

  return cjkCount + wordTokens;
}
