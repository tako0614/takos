import { createMemo, type JSX } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { toSafeHref } from "../../lib/safeHref.ts";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard.ts";

function isInternalHref(href: string): boolean {
  try {
    const url = new URL(href, globalThis.location.href);
    return url.origin === globalThis.location.origin;
  } catch {
    return false;
  }
}

function navigateToInternalHref(href: string) {
  const url = new URL(href, globalThis.location.href);
  const next = `${url.pathname}${url.search}${url.hash}`;
  globalThis.history.pushState(null, "", next);
  globalThis.dispatchEvent(new PopStateEvent("popstate"));
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

function parseInlineMarkdown(text: string): (JSX.Element | string)[] {
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
                navigateToInternalHref(safeHref);
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

export function MarkdownRenderer(props: { content: string }) {
  const renderContent = createMemo(() => {
    const lines = props.content.split("\n");
    const elements: JSX.Element[] = [];
    let codeBlock: string[] = [];
    let inCodeBlock = false;
    let codeLang = "";
    let listItems: JSX.Element[] = [];
    let listType: "ul" | "ol" | null = null;

    const flushList = () => {
      if (listItems.length > 0 && listType) {
        if (listType === "ul") {
          elements.push(
            <ul class="list-disc pl-6 mb-4 space-y-1">{listItems}</ul>,
          );
        } else {
          elements.push(
            <ol class="list-decimal pl-6 mb-4 space-y-1">{listItems}</ol>,
          );
        }
        listItems = [];
        listType = null;
      }
    };

    lines.forEach((line, _i) => {
      // Code block
      if (line.startsWith("```")) {
        flushList();
        if (inCodeBlock) {
          const code = codeBlock.join("\n");
          const lang = codeLang;
          elements.push(
            <CodeBlock code={code} language={lang} />,
          );
          codeBlock = [];
          inCodeBlock = false;
          codeLang = "";
        } else {
          inCodeBlock = true;
          codeLang = line.slice(3).trim();
        }
        return;
      }

      if (inCodeBlock) {
        codeBlock.push(line);
        return;
      }

      // Headers
      if (line.startsWith("#### ")) {
        flushList();
        elements.push(
          <h4 class="text-base font-semibold text-zinc-900 dark:text-zinc-100 mt-4 mb-2">
            {parseInlineMarkdown(line.slice(5))}
          </h4>,
        );
        return;
      }
      if (line.startsWith("### ")) {
        flushList();
        elements.push(
          <h3 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mt-5 mb-2">
            {parseInlineMarkdown(line.slice(4))}
          </h3>,
        );
        return;
      }
      if (line.startsWith("## ")) {
        flushList();
        elements.push(
          <h2 class="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mt-6 mb-3">
            {parseInlineMarkdown(line.slice(3))}
          </h2>,
        );
        return;
      }
      if (line.startsWith("# ")) {
        flushList();
        elements.push(
          <h1 class="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mt-6 mb-3">
            {parseInlineMarkdown(line.slice(2))}
          </h1>,
        );
        return;
      }

      // Unordered list
      if (line.match(/^[-*]\s/)) {
        if (listType !== "ul") {
          flushList();
          listType = "ul";
        }
        listItems.push(
          <li class="text-zinc-900 dark:text-zinc-100">
            {parseInlineMarkdown(line.slice(2))}
          </li>,
        );
        return;
      }

      // Ordered list
      const olMatch = line.match(/^(\d+)\.\s(.*)$/);
      if (olMatch) {
        if (listType !== "ol") {
          flushList();
          listType = "ol";
        }
        listItems.push(
          <li class="text-zinc-900 dark:text-zinc-100">
            {parseInlineMarkdown(olMatch[2])}
          </li>,
        );
        return;
      }

      flushList();

      // Empty line
      if (line.trim() === "") {
        elements.push(<div class="h-4" />);
        return;
      }

      // Regular paragraph
      elements.push(
        <p class="mb-4 text-zinc-900 dark:text-zinc-100">
          {parseInlineMarkdown(line)}
        </p>,
      );
    });

    flushList(lines.length);
    return elements;
  });

  return <>{renderContent()}</>;
}
