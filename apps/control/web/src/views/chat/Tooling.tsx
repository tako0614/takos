import { useState } from 'react';
import { useI18n } from '../../providers/I18nProvider';
import { Icons } from '../../lib/Icons';
import type { ToolExecution } from '../../types';

function getToolInfo(name: string) {
  const normalized = name.toLowerCase();
  if (normalized.includes('web_search') || normalized.includes('search')) return { icon: <Icons.Globe />, accent: 'text-blue-500' };
  if (normalized.includes('web_fetch') || normalized.includes('browse')) return { icon: <Icons.Globe />, accent: 'text-cyan-500' };
  if (normalized.includes('file_read') || normalized.includes('read')) return { icon: <Icons.File />, accent: 'text-emerald-500' };
  if (normalized.includes('file_write') || normalized.includes('write')) return { icon: <Icons.File />, accent: 'text-amber-500' };
  if (normalized.includes('file_list') || normalized.includes('list')) return { icon: <Icons.Folder />, accent: 'text-indigo-500' };
  if (normalized.includes('runtime_exec') || normalized.includes('exec')) return { icon: <Icons.Code />, accent: 'text-violet-500' };
  if (normalized.includes('deploy')) return { icon: <Icons.Upload />, accent: 'text-orange-500' };
  if (normalized.includes('memory') || normalized.includes('remember') || normalized.includes('recall')) return { icon: <Icons.HardDrive />, accent: 'text-pink-500' };
  return { icon: <Icons.Settings />, accent: 'text-zinc-500' };
}

function formatToolName(name: string): string {
  return name
    .replace(/^(file_|web_|runtime_|deploy_|memory_)/, '')
    .replace(/_/g, ' ');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

export function PersistedToolCalls({ toolExecutions }: { toolExecutions: ToolExecution[] }) {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());

  if (!toolExecutions || toolExecutions.length === 0) return null;

  const hasErrors = toolExecutions.some((te) => te.error);
  const totalDuration = toolExecutions.reduce((sum, te) => sum + (te.duration_ms || 0), 0);

  const toggleToolExpanded = (index: number) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <div className="mb-3">
      <button
        className="flex items-center gap-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg px-2 py-1 -ml-2 transition-colors"
        onClick={() => setIsExpanded((prev) => !prev)}
        type="button"
      >
        <Icons.Settings className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" />
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          {t('toolsExecuted', { count: toolExecutions.length })}
          {hasErrors && <span className="text-red-500 dark:text-red-400 font-medium ml-1">{t('withErrors')}</span>}
        </span>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">{formatDuration(totalDuration)}</span>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">{isExpanded ? '▼' : '▶'}</span>
      </button>

      {isExpanded && (
        <div className="mt-1 ml-1 pl-4 border-l-2 border-zinc-200 dark:border-zinc-700 space-y-0.5">
          {toolExecutions.map((te, index) => {
            const info = getToolInfo(te.name);
            const isToolExpanded = expandedTools.has(index);
            const hasDetails = Object.keys(te.arguments || {}).length > 0 || !!te.result || !!te.error;
            return (
              <div key={`${te.name}-${index}`}>
                <div className="flex items-center gap-2 py-0.5">
                  {te.error ? (
                    <Icons.AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0" />
                  ) : (
                    <Icons.Check className="w-3 h-3 text-green-500 flex-shrink-0" />
                  )}
                  <span className={`text-sm ${te.error ? 'text-red-600 dark:text-red-400' : 'text-zinc-600 dark:text-zinc-400'} capitalize`}>
                    {formatToolName(te.name)}
                  </span>
                  {te.duration_ms ? (
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">{formatDuration(te.duration_ms)}</span>
                  ) : null}
                  {hasDetails ? (
                    <button
                      type="button"
                      className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                      onClick={() => toggleToolExpanded(index)}
                    >
                      {isToolExpanded ? '▼' : '▶'}
                    </button>
                  ) : null}
                </div>

                {isToolExpanded && hasDetails && (
                  <div className="ml-5 pb-2 text-xs space-y-2">
                    {Object.keys(te.arguments || {}).length > 0 && (
                      <div>
                        <div className="text-zinc-500 dark:text-zinc-400 font-medium mb-1">{t('toolArguments')}</div>
                        <pre className="text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(te.arguments, null, 2)}
                        </pre>
                      </div>
                    )}

                    {te.error && (
                      <div>
                        <div className="text-red-600 dark:text-red-400 font-medium mb-1">{t('toolError')}</div>
                        <pre className="text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                          {te.error}
                        </pre>
                      </div>
                    )}

                    {te.result && !te.error && (
                      <div>
                        <div className="text-zinc-500 dark:text-zinc-400 font-medium mb-1">{t('toolResult')}</div>
                        <pre className="text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                          {te.result.length > 1000 ? `${te.result.slice(0, 1000)}...` : te.result}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
