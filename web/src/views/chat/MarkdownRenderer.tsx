import { createMemo, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { useNavigate } from "@solidjs/router";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { toSafeHref } from "../../lib/safeHref.ts";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard.ts";
import { parseMarkdownBlocks, type TableAlign } from "./markdownBlocks.ts";

function isInternalHref(href: string): boolean {
  try {
    const url = new URL(href, globalThis.location.href);
    return url.origin === globalThis.location.origin;
  } catch {
    return false;
  }
}

/**
 * Build a same-origin relative path from a safe href so the Solid router can
 * navigate without a full reload. We avoid `history.pushState` +
 * `dispatchEvent('popstate')` (which the router does not officially listen
 * to) and instead delegate to `useNavigate` from `@solidjs/router`.
 *
 * Workaround note: if this renderer ever ends up mounted outside a Solid
 * `<Router>` context (e.g. embedded in a non-routed shell), `useNavigate`
 * will throw. In that case we fall back to a plain `location.assign`, which
 * is safe (full reload) — at the cost of losing client-side routing.
 */
function toInternalPath(href: string): string {
  const url = new URL(href, globalThis.location.href);
  return `${url.pathname}${url.search}${url.hash}`;
}

function CodeBlock(props: { code: string; language: string }) {
  const { t } = useI18n();
  const { copied, copyFailed, copy } = useCopyToClipboard();

  return (
    <pre class="rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden mb-4">
      <div class="flex items-center justify-between px-4 py-2 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
        <span class="text-xs text-zinc-500 dark:text-zinc-400 font-mono">{props.language || 'code'}</span>
        <button
          class="p-1 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 flex items-center gap-1"
          onClick={() => copy(props.code)}
          type="button"
          aria-label={copyFailed() ? t('copyFailed') || 'Copy failed' : copied() ? t('copied') || 'Copied' : t('copyCode') || 'Copy code'}
        >
          {copyFailed() ? (
            <span class="text-xs text-red-600 dark:text-red-400">{t('copyFailed') || 'Copy failed'}</span>
          ) : copied() ? (
            <>
              <Icons.Check class="w-4 h-4 text-zinc-700 dark:text-zinc-300" />
              <span class="text-xs text-zinc-700 dark:text-zinc-300">{t('copied') || 'Copied!'}</span>
            </>
          ) : (
            <Icons.Copy class="w-4 h-4" />
          )}
        </button>
      </div>
      <code class="block p-4 overflow-x-auto font-mono text-sm text-zinc-900 dark:text-zinc-100">{props.code}</code>
    </pre>
  );
}

type InternalNavigate = (path: string) => void;

function parseInlineMarkdown(
  text: string,
  navigateInternal: InternalNavigate,
): (JSX.Element | string)[] {
  const result: (JSX.Element | string)[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      result.push(
        <strong class="font-semibold text-zinc-900 dark:text-zinc-100">
          {boldMatch[1]}
        </strong>,
      );
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      result.push(<em class="italic">{italicMatch[1]}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      result.push(
        <code class="px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 font-mono text-sm text-zinc-900 dark:text-zinc-100">
          {codeMatch[1]}
        </code>,
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Image: `![alt](url)`. Must be tried before the link rule below so the
    // leading `!` is not emitted as a literal followed by a plain link. The
    // src is sanitized through `toSafeHref` (blocks javascript:/data:/vbscript:
    // and disallowed schemes); unsafe sources degrade to the alt text.
    const imageMatch = remaining.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (imageMatch) {
      const safeSrc = toSafeHref(imageMatch[2]);
      const alt = imageMatch[1];
      if (safeSrc) {
        result.push(
          <img
            src={safeSrc}
            alt={alt}
            loading="lazy"
            class="max-w-full h-auto rounded-lg my-2"
          />,
        );
      } else if (alt) {
        result.push(alt);
      }
      remaining = remaining.slice(imageMatch[0].length);
      continue;
    }

    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      const safeHref = toSafeHref(linkMatch[2]);
      if (safeHref) {
        const internal = isInternalHref(safeHref);
        result.push(
          <a
            href={safeHref}
            target={internal ? undefined : "_blank"}
            rel={internal ? undefined : "noopener noreferrer"}
            class="text-zinc-900 dark:text-zinc-100 underline hover:no-underline"
            onClick={internal
              ? (event) => {
                event.preventDefault();
                navigateInternal(toInternalPath(safeHref));
              }
              : undefined}
          >
            {linkMatch[1]}
          </a>,
        );
      } else {
        result.push(linkMatch[1]);
      }
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    result.push(remaining[0]);
    remaining = remaining.slice(1);
  }

  const merged: (JSX.Element | string)[] = [];
  let currentStr = "";
  for (const node of result) {
    if (typeof node === "string") {
      currentStr += node;
    } else {
      if (currentStr) {
        merged.push(currentStr);
        currentStr = "";
      }
      merged.push(node);
    }
  }
  if (currentStr) {
    merged.push(currentStr);
  }

  return merged;
}

function resolveInternalNavigate(): InternalNavigate {
  // `useNavigate` requires the component to be rendered inside a Solid
  // `<Router>`. If it isn't (test renderers, non-routed embeds), `useNavigate`
  // throws — we fall back to a full-page navigation in that case.
  try {
    const navigate = useNavigate();
    return (path: string) => navigate(path);
  } catch {
    return (path: string) => {
      globalThis.location.assign(path);
    };
  }
}

/**
 * Lightweight, intentionally limited Markdown renderer for chat output.
 *
 * This is a deliberately hand-rolled, line-at-a-time parser rather than a full
 * Markdown library. It avoids `innerHTML` entirely (every node is a real JSX
 * element) and routes all links/images through {@link toSafeHref}, which is the
 * primary reason it is not swapped for `marked`/`markdown-it` + DOMPurify.
 *
 * Supported: headings (`#`..`####`), bold (`**`), italic (`*`), inline code,
 * fenced code blocks (with copy button), unordered/ordered lists, links
 * (internal links use the Solid router), and images (`![alt](url)`).
 *
 * Known, intentional limitations (callers should not rely on these):
 * - No nested/adjacent emphasis (e.g. `**a*b*c**`); the emphasis regexes do not
 *   allow inner `*`.
 * - No blockquotes or tables.
 * - No multi-line paragraph wrapping: each source line is its own block and a
 *   blank line renders as a fixed spacer.
 * - Link/image URLs cannot contain `)`.
 *
 * If richer Markdown is needed, replace this with a vetted library plus a
 * sanitizer rather than extending the regex grammar further.
 */
const HEADING_CLASS: Record<1 | 2 | 3 | 4, string> = {
  1: "text-2xl font-bold text-zinc-900 dark:text-zinc-100 mt-6 mb-3",
  2: "text-xl font-semibold text-zinc-900 dark:text-zinc-100 mt-6 mb-3",
  3: "text-lg font-semibold text-zinc-900 dark:text-zinc-100 mt-5 mb-2",
  4: "text-base font-semibold text-zinc-900 dark:text-zinc-100 mt-4 mb-2",
};

function alignClass(align: TableAlign): string {
  return align === "center"
    ? "text-center"
    : align === "right"
    ? "text-right"
    : "text-left";
}

export function MarkdownRenderer(props: { content: string }) {
  const navigateInternal = resolveInternalNavigate();
  const renderContent = createMemo(() => {
    const inline = (text: string) => parseInlineMarkdown(text, navigateInternal);
    return parseMarkdownBlocks(props.content).map((block): JSX.Element => {
      switch (block.kind) {
        case "heading":
          return (
            <Dynamic
              component={`h${block.level}`}
              class={HEADING_CLASS[block.level]}
            >
              {inline(block.text)}
            </Dynamic>
          );
        case "code":
          return <CodeBlock code={block.code} language={block.lang} />;
        case "list":
          return block.ordered
            ? (
              <ol class="list-decimal pl-6 mb-4 space-y-1">
                {block.items.map((item) => (
                  <li class="text-zinc-900 dark:text-zinc-100">
                    {inline(item)}
                  </li>
                ))}
              </ol>
            )
            : (
              <ul class="list-disc pl-6 mb-4 space-y-1">
                {block.items.map((item) => (
                  <li class="text-zinc-900 dark:text-zinc-100">
                    {inline(item)}
                  </li>
                ))}
              </ul>
            );
        case "quote":
          return (
            <blockquote class="border-l-4 border-zinc-300 dark:border-zinc-600 pl-4 my-4 italic text-zinc-600 dark:text-zinc-400">
              {block.lines.map((l) => <p class="mb-1">{inline(l)}</p>)}
            </blockquote>
          );
        case "table":
          return (
            <div class="overflow-x-auto mb-4">
              <table class="min-w-full text-sm border-collapse">
                <thead>
                  <tr>
                    {block.header.map((cell, idx) => (
                      <th
                        class={`border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 font-semibold bg-zinc-50 dark:bg-zinc-800 ${
                          alignClass(block.align[idx] ?? null)
                        }`}
                      >
                        {inline(cell)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row) => (
                    <tr>
                      {row.map((cell, idx) => (
                        <td
                          class={`border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-zinc-900 dark:text-zinc-100 ${
                            alignClass(block.align[idx] ?? null)
                          }`}
                        >
                          {inline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        case "hr":
          return <hr class="my-4 border-zinc-200 dark:border-zinc-700" />;
        case "blank":
          return <div class="h-4" />;
        case "paragraph":
          return (
            <p class="mb-4 text-zinc-900 dark:text-zinc-100">
              {inline(block.text)}
            </p>
          );
      }
    });
  });

  return <>{renderContent()}</>;
}
