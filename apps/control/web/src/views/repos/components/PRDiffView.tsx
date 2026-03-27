import type { FileDiff } from '../../../types';
import { Icons } from '../../../lib/Icons';
import { Card } from '../../../components/ui/Card';
import { useI18n } from '../../../store/i18n';

interface PRDiffViewProps {
  diffs: FileDiff[];
  expandedFiles: Set<string>;
  onToggleFile: (path: string) => void;
}

function getFileStatusIcon(status: FileDiff['status']) {
  switch (status) {
    case 'added':
      return <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">A</span>;
    case 'modified':
      return <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400">M</span>;
    case 'deleted':
      return <span className="text-xs font-bold text-zinc-400 dark:text-zinc-500">D</span>;
    case 'renamed':
      return <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">R</span>;
  }
}

export function PRDiffView({ diffs, expandedFiles, onToggleFile }: PRDiffViewProps) {
  const { t } = useI18n();

  const totalChanges = diffs.reduce(
    (acc, file) => ({
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 }
  );

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-4 mb-4 text-sm text-zinc-500">
        <span>{t('prFilesChanged', { count: diffs.length })}</span>
        <span className="text-zinc-900 dark:text-zinc-100 font-medium">{t('additionsLabel', { count: totalChanges.additions })}</span>
        <span className="text-zinc-500 dark:text-zinc-400 font-medium">{t('deletionsLabel', { count: totalChanges.deletions })}</span>
      </div>

      <div className="space-y-2">
        {diffs.map(file => (
          <Card key={file.path} padding="none" className="overflow-hidden">
            <div
              className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              onClick={() => onToggleFile(file.path)}
            >
              <div className="flex items-center gap-3">
                {expandedFiles.has(file.path) ? (
                  <Icons.ChevronDown className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                ) : (
                  <Icons.ChevronRight className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                )}
                {getFileStatusIcon(file.status)}
                <span className="text-sm text-zinc-900 dark:text-zinc-100 font-mono">
                  {file.old_path && file.old_path !== file.path ? (
                    <>
                      <span className="text-zinc-400 dark:text-zinc-500 line-through">{file.old_path}</span>
                      <Icons.ChevronRight className="w-4 h-4 inline mx-1 text-zinc-400 dark:text-zinc-500" />
                    </>
                  ) : null}
                  {file.path}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-zinc-900 dark:text-zinc-100 font-medium">+{file.additions}</span>
                <span className="text-zinc-500 dark:text-zinc-400 font-medium">-{file.deletions}</span>
              </div>
            </div>

            {expandedFiles.has(file.path) && (
              <div className="bg-zinc-50 dark:bg-zinc-900 overflow-x-auto border-t" style={{ borderColor: 'var(--color-border-primary)' }}>
                {file.hunks.map((hunk, hunkIndex) => (
                  <div key={hunkIndex}>
                    <div className="px-4 py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 text-xs font-mono border-b" style={{ borderColor: 'var(--color-border-primary)' }}>
                      @@ -{hunk.old_start},{hunk.old_lines} +{hunk.new_start},{hunk.new_lines} @@
                    </div>
                    <div className="font-mono text-xs">
                      {hunk.lines.map((line, lineIndex) => (
                        <div
                          key={lineIndex}
                          className={`flex ${
                            line.type === 'addition'
                              ? 'bg-zinc-100 dark:bg-zinc-800'
                              : line.type === 'deletion'
                              ? 'bg-zinc-50 dark:bg-zinc-850'
                              : ''
                          }`}
                        >
                          <span className="w-12 px-2 text-right text-zinc-400 select-none border-r" style={{ borderColor: 'var(--color-border-primary)' }}>
                            {line.old_line || ''}
                          </span>
                          <span className="w-12 px-2 text-right text-zinc-400 select-none border-r" style={{ borderColor: 'var(--color-border-primary)' }}>
                            {line.new_line || ''}
                          </span>
                          <span className={`w-4 text-center select-none ${
                            line.type === 'addition'
                              ? 'text-zinc-900 dark:text-zinc-100 font-bold'
                              : line.type === 'deletion'
                              ? 'text-zinc-400 dark:text-zinc-500 font-bold'
                              : 'text-zinc-400 dark:text-zinc-500'
                          }`}>
                            {line.type === 'addition' ? '+' : line.type === 'deletion' ? '-' : ' '}
                          </span>
                          <span className={`flex-1 px-2 whitespace-pre ${
                            line.type === 'addition'
                              ? 'text-zinc-900 dark:text-zinc-100'
                              : line.type === 'deletion'
                              ? 'text-zinc-500 dark:text-zinc-400'
                              : 'text-zinc-700 dark:text-zinc-300'
                          }`}>{line.content}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
