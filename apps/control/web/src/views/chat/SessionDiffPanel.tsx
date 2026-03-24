import { useState } from 'react';
import { useI18n } from '../../providers/I18nProvider';
import { Icons } from '../../lib/Icons';
import type { SessionDiff } from '../../types';

export function SessionDiffPanel({
  sessionDiff,
  onMerge,
  isMerging,
  onDismiss,
}: {
  sessionDiff: { sessionId: string; sessionStatus?: string; diff?: SessionDiff };
  onMerge: () => void;
  isMerging: boolean;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  if (!sessionDiff.diff) return null;

  const isAlreadyMerged = sessionDiff.sessionStatus === 'merged';

  const toggleFile = (path: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const getChangeIcon = (type: string) => {
    switch (type) {
      case 'add': return <Icons.Plus />;
      case 'modify': return <Icons.Edit />;
      case 'delete': return <Icons.Trash />;
      default: return <Icons.File />;
    }
  };

  return (
    <div className="mx-4 my-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center gap-2">
          <Icons.GitMerge />
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{t('fileChanges')}</span>
          <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium">{sessionDiff.diff.changes.length}</span>
          {isAlreadyMerged && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{t('alreadyMerged')}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isAlreadyMerged && (
            <button
              className="px-3 py-1.5 text-xs font-medium bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 text-white dark:text-zinc-900 rounded-lg transition-colors disabled:opacity-50"
              onClick={onMerge}
              disabled={isMerging}
            >
              {isMerging ? t('merging') : t('merge')}
            </button>
          )}
          <button className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-zinc-500 dark:text-zinc-400" onClick={onDismiss}>
            <Icons.X />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {sessionDiff.diff.changes.map((change) => {
          const isExpanded = expandedFiles.has(change.path);
          return (
            <div key={change.path} className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
              <button
                className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                onClick={() => toggleFile(change.path)}
              >
                <span className="text-zinc-500 dark:text-zinc-400">{getChangeIcon(change.type)}</span>
                <span className="flex-1 text-sm text-zinc-900 dark:text-zinc-100 font-mono">{change.path}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{change.type}</span>
                <span className="text-zinc-500 dark:text-zinc-400">{isExpanded ? '−' : '+'}</span>
              </button>

              {isExpanded && (
                <div className="border-t border-zinc-200 dark:border-zinc-700">
                  {change.diff && (
                    <pre className="p-3 text-xs text-zinc-700 dark:text-zinc-300 font-mono overflow-x-auto whitespace-pre-wrap">{change.diff}</pre>
                  )}
                  {change.content && !change.diff && (
                    <pre className="p-3 text-xs text-zinc-700 dark:text-zinc-300 font-mono overflow-x-auto whitespace-pre-wrap">{change.content}</pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
