import { useMemo, type ReactNode } from 'react';
import { Icons } from '../../lib/Icons';
import { useI18n } from '../../store/i18n';
import { toSafeHref } from '../../lib/safeHref';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';

function CodeBlock({ code, language }: { code: string; language: string }) {
  const { t } = useI18n();
  const { copied, copyFailed, copy } = useCopyToClipboard();

  return (
    <pre className="rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden mb-4">
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
        <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">{language || 'code'}</span>
        <button
          className="p-1 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 flex items-center gap-1"
          onClick={() => copy(code)}
          type="button"
          aria-label={copyFailed ? t('copyFailed') || 'Copy failed' : copied ? t('copied') || 'Copied' : t('copyCode') || 'Copy code'}
        >
          {copyFailed ? (
            <span className="text-xs text-red-600 dark:text-red-400">{t('copyFailed') || 'Copy failed'}</span>
          ) : copied ? (
            <>
              <Icons.Check className="w-4 h-4 text-zinc-700 dark:text-zinc-300" />
              <span className="text-xs text-zinc-700 dark:text-zinc-300">{t('copied') || 'Copied!'}</span>
            </>
          ) : (
            <Icons.Copy className="w-4 h-4" />
          )}
        </button>
      </div>
      <code className="block p-4 overflow-x-auto font-mono text-sm text-zinc-900 dark:text-zinc-100">{code}</code>
    </pre>
  );
}

function parseInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const result: ReactNode[] = [];
  let remaining = text;
  let idx = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      result.push(<strong key={`${keyPrefix}-${idx++}`} className="font-semibold text-zinc-900 dark:text-zinc-100">{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      result.push(<em key={`${keyPrefix}-${idx++}`} className="italic">{italicMatch[1]}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      result.push(<code key={`${keyPrefix}-${idx++}`} className="px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 font-mono text-sm text-zinc-900 dark:text-zinc-100">{codeMatch[1]}</code>);
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      const safeHref = toSafeHref(linkMatch[2]);
      if (safeHref) {
        result.push(
          <a key={`${keyPrefix}-${idx++}`} href={safeHref} target="_blank" rel="noopener noreferrer" className="text-zinc-900 dark:text-zinc-100 underline hover:no-underline">
            {linkMatch[1]}
          </a>
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

  const merged: ReactNode[] = [];
  let currentStr = '';
  for (const node of result) {
    if (typeof node === 'string') {
      currentStr += node;
    } else {
      if (currentStr) {
        merged.push(currentStr);
        currentStr = '';
      }
      merged.push(node);
    }
  }
  if (currentStr) {
    merged.push(currentStr);
  }

  return merged;
}

export function MarkdownRenderer({ content }: { content: string }) {
  const renderContent = useMemo(() => {
    const lines = content.split('\n');
    const elements: ReactNode[] = [];
    let codeBlock: string[] = [];
    let inCodeBlock = false;
    let codeLang = '';
    let listItems: ReactNode[] = [];
    let listType: 'ul' | 'ol' | null = null;
    let listStartLine = -1;
    let listKeyIndex = 0;

    const flushList = (lineIndex: number) => {
      if (listItems.length > 0 && listType) {
        const ListTag = listType;
        const stableListLine = listStartLine >= 0 ? listStartLine : lineIndex;
        elements.push(
          <ListTag key={`list-${listType}-${stableListLine}-${listKeyIndex++}`} className={listType === 'ul' ? 'list-disc pl-6 mb-4 space-y-1' : 'list-decimal pl-6 mb-4 space-y-1'}>
            {listItems}
          </ListTag>
        );
        listItems = [];
        listType = null;
        listStartLine = -1;
      }
    };

    lines.forEach((line, i) => {
      // Code block
      if (line.startsWith('```')) {
        flushList(i);
        if (inCodeBlock) {
          const code = codeBlock.join('\n');
          const lang = codeLang;
          elements.push(
            <CodeBlock key={`code-${i}`} code={code} language={lang} />
          );
          codeBlock = [];
          inCodeBlock = false;
          codeLang = '';
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
      if (line.startsWith('#### ')) {
        flushList(i);
        elements.push(<h4 key={`h4-${i}`} className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mt-4 mb-2">{parseInlineMarkdown(line.slice(5), `h4-${i}`)}</h4>);
        return;
      }
      if (line.startsWith('### ')) {
        flushList(i);
        elements.push(<h3 key={`h3-${i}`} className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mt-5 mb-2">{parseInlineMarkdown(line.slice(4), `h3-${i}`)}</h3>);
        return;
      }
      if (line.startsWith('## ')) {
        flushList(i);
        elements.push(<h2 key={`h2-${i}`} className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mt-6 mb-3">{parseInlineMarkdown(line.slice(3), `h2-${i}`)}</h2>);
        return;
      }
      if (line.startsWith('# ')) {
        flushList(i);
        elements.push(<h1 key={`h1-${i}`} className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mt-6 mb-3">{parseInlineMarkdown(line.slice(2), `h1-${i}`)}</h1>);
        return;
      }

      // Unordered list
      if (line.match(/^[-*]\s/)) {
        if (listType !== 'ul') {
          flushList(i);
          listType = 'ul';
          listStartLine = i;
        }
        listItems.push(<li key={`li-${i}`} className="text-zinc-900 dark:text-zinc-100">{parseInlineMarkdown(line.slice(2), `li-${i}`)}</li>);
        return;
      }

      // Ordered list
      const olMatch = line.match(/^(\d+)\.\s(.*)$/);
      if (olMatch) {
        if (listType !== 'ol') {
          flushList(i);
          listType = 'ol';
          listStartLine = i;
        }
        listItems.push(<li key={`oli-${i}`} className="text-zinc-900 dark:text-zinc-100">{parseInlineMarkdown(olMatch[2], `oli-${i}`)}</li>);
        return;
      }

      flushList(i);

      // Empty line
      if (line.trim() === '') {
        elements.push(<div key={`spacer-${i}`} className="h-4" />);
        return;
      }

      // Regular paragraph
      elements.push(
        <p key={`p-${i}`} className="mb-4 text-zinc-900 dark:text-zinc-100">
          {parseInlineMarkdown(line, `p-${i}`)}
        </p>
      );
    });

    flushList(lines.length);
    return elements;
  }, [content]);

  return <>{renderContent}</>;
}
