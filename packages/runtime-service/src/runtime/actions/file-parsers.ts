// ---------------------------------------------------------------------------
// File parsing utilities for GitHub Actions key-value and PATH files
// ---------------------------------------------------------------------------

/**
 * Parse a GitHub Actions key-value format file (used for GITHUB_OUTPUT, GITHUB_ENV).
 * Supports both `KEY=VALUE` and heredoc `KEY<<DELIMITER` formats.
 */
export function parseKeyValueFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const heredocMatch = line.match(/^([^=<>]+)<<(.+)$/);
    if (heredocMatch) {
      const name = heredocMatch[1].trim();
      const delimiter = heredocMatch[2].trim();
      const valueLines: string[] = [];
      i++;
      while (i < lines.length && lines[i] !== delimiter) {
        valueLines.push(lines[i]);
        i++;
      }
      result[name] = valueLines.join("\n");
      continue;
    }

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;
    const name = line.slice(0, eqIndex);
    const value = line.slice(eqIndex + 1);
    result[name] = value;
  }

  return result;
}

/**
 * Parse a GitHub Actions PATH additions file (used for GITHUB_PATH).
 * Returns an array of non-empty, trimmed path entries.
 */
export function parsePathFile(content: string): string[] {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
