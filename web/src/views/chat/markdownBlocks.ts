/**
 * Pure block-level Markdown splitter for the chat / README renderer.
 *
 * Kept free of JSX so it can be unit-tested directly. Inline syntax (bold,
 * italic, code, links, images) is intentionally NOT handled here — block text
 * is returned raw and parsed inline at render time. This adds tables,
 * blockquotes, and horizontal rules on top of the original headings / lists /
 * code-fences / paragraphs.
 */

export type TableAlign = "left" | "center" | "right" | null;

export type MarkdownBlock =
  | { kind: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { kind: "code"; lang: string; code: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "table"; header: string[]; align: TableAlign[]; rows: string[][] }
  | { kind: "hr" }
  | { kind: "paragraph"; text: string }
  | { kind: "blank" };

const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING_RE = /^(#{1,4})\s+(.*)$/;
const UL_RE = /^[-*]\s+(.*)$/;
const OL_RE = /^(\d+)\.\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;

/** Split a `| a | b |` table row into trimmed cells (outer pipes optional). */
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((cell) => cell.trim());
}

/** A GFM table separator row: every cell is like `---`, `:--`, `--:`, `:-:`. */
function isTableSeparator(line: string): boolean {
  const s = line.trim();
  if (!s.includes("-") || !s.includes("|")) return false;
  const cells = splitTableRow(s);
  return cells.length > 0 &&
    cells.every((cell) => /^:?-+:?$/.test(cell.replace(/\s/g, "")));
}

function parseAlign(separatorCells: string[]): TableAlign[] {
  return separatorCells.map((cell) => {
    const c = cell.trim();
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });
}

export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++; // consume the closing fence (or fall off the end)
      blocks.push({ kind: "code", lang, code: code.join("\n") });
      continue;
    }

    // Horizontal rule (checked before lists so `---` / `***` aren't list items).
    if (HR_RE.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    // Heading.
    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4,
        text: heading[2],
      });
      i++;
      continue;
    }

    // Table: a pipe row immediately followed by a separator row.
    if (
      line.includes("|") && i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const header = splitTableRow(line);
      const align = parseAlign(splitTableRow(lines[i + 1]));
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", header, align, rows });
      continue;
    }

    // Blockquote (consecutive `>` lines folded together).
    const quote = QUOTE_RE.exec(line);
    if (quote) {
      const quoteLines: string[] = [quote[1]];
      i++;
      while (i < lines.length) {
        const next = QUOTE_RE.exec(lines[i]);
        if (!next) break;
        quoteLines.push(next[1]);
        i++;
      }
      blocks.push({ kind: "quote", lines: quoteLines });
      continue;
    }

    // Unordered list (consecutive items).
    if (UL_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = UL_RE.exec(lines[i]);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      blocks.push({ kind: "list", ordered: false, items });
      continue;
    }

    // Ordered list (consecutive items).
    if (OL_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = OL_RE.exec(lines[i]);
        if (!m) break;
        items.push(m[2]);
        i++;
      }
      blocks.push({ kind: "list", ordered: true, items });
      continue;
    }

    // Blank line → vertical spacing.
    if (line.trim() === "") {
      blocks.push({ kind: "blank" });
      i++;
      continue;
    }

    // Plain paragraph line.
    blocks.push({ kind: "paragraph", text: line });
    i++;
  }

  return blocks;
}
