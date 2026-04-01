import { createSignal } from 'solid-js';
import { Show, For } from 'solid-js';
import { useI18n } from '../../store/i18n.ts';
import { Icons } from '../../lib/Icons.tsx';
import type { ToolExecution } from '../../types/index.ts';

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

export function PersistedToolCalls(props: { toolExecutions: ToolExecution[] }) {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = createSignal(false);
  const [expandedTools, setExpandedTools] = createSignal<Set<number>>(new Set());

  const hasErrors = () => props.toolExecutions.some((te) => te.error);
  const totalDuration = () => props.toolExecutions.reduce((sum, te) => sum + (te.duration_ms || 0), 0);

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
    <Show when={props.toolExecutions && props.toolExecutions.length > 0}>
      <div class="mb-3">
        <button
          type="button"
          class="flex items-center gap-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg px-2 py-1 -ml-2 transition-colors"
          onClick={() => setIsExpanded((prev) => !prev)}
        >
          <Icons.Settings class="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" />
          <span class="text-sm text-zinc-500 dark:text-zinc-400">
            {t('toolsExecuted', { count: props.toolExecutions.length })}
            <Show when={hasErrors()}>
              <span class="text-red-500 dark:text-red-400 font-medium ml-1">{t('withErrors')}</span>
            </Show>
          </span>
          <span class="text-xs text-zinc-400 dark:text-zinc-500">{formatDuration(totalDuration())}</span>
          <span class="text-xs text-zinc-400 dark:text-zinc-500">{isExpanded() ? '\u25BC' : '\u25B6'}</span>
        </button>

        <Show when={isExpanded()}>
          <div class="mt-1 ml-1 pl-4 border-l-2 border-zinc-200 dark:border-zinc-700 space-y-0.5">
            <For each={props.toolExecutions}>{(te, index) => {
              const hasDetails = () => Object.keys(te.arguments || {}).length > 0 || !!te.result || !!te.error;
              return (
                <div>
                  <div class="flex items-center gap-2 py-0.5">
                    <Show when={te.error} fallback={
                      <Icons.Check class="w-3 h-3 text-green-500 flex-shrink-0" />
                    }>
                      <Icons.AlertTriangle class="w-3 h-3 text-red-500 flex-shrink-0" />
                    </Show>
                    <span class={`text-sm ${te.error ? 'text-red-600 dark:text-red-400' : 'text-zinc-600 dark:text-zinc-400'} capitalize`}>
                      {formatToolName(te.name)}
                    </span>
                    <Show when={te.duration_ms}>
                      <span class="text-xs text-zinc-400 dark:text-zinc-500">{formatDuration(te.duration_ms!)}</span>
                    </Show>
                    <Show when={hasDetails()}>
                      <button
                        type="button"
                        class="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                        onClick={() => toggleToolExpanded(index())}
                      >
                        {expandedTools().has(index()) ? '\u25BC' : '\u25B6'}
                      </button>
                    </Show>
                  </div>

                  <Show when={expandedTools().has(index()) && hasDetails()}>
                    <div class="ml-5 pb-2 text-xs space-y-2">
                      <Show when={Object.keys(te.arguments || {}).length > 0}>
                        <div>
                          <div class="text-zinc-500 dark:text-zinc-400 font-medium mb-1">{t('toolArguments')}</div>
                          <pre class="text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                            {JSON.stringify(te.arguments, null, 2)}
                          </pre>
                        </div>
                      </Show>

                      <Show when={te.error}>
                        <div>
                          <div class="text-red-600 dark:text-red-400 font-medium mb-1">{t('toolError')}</div>
                          <pre class="text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                            {te.error}
                          </pre>
                        </div>
                      </Show>

                      <Show when={te.result && !te.error}>
                        <div>
                          <div class="text-zinc-500 dark:text-zinc-400 font-medium mb-1">{t('toolResult')}</div>
                          <pre class="text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                            {te.result!.length > 1000 ? `${te.result!.slice(0, 1000)}...` : te.result}
                          </pre>
                        </div>
                      </Show>
                    </div>
                  </Show>
                </div>
              );
            }}</For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
