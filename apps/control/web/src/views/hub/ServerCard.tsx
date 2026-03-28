import { useState } from 'react';
import { Icons } from '../../lib/Icons';
import { useI18n } from '../../store/i18n';
import { Button } from '../../components/ui/Button';
import type { McpServerRecord } from '../../types';

export type ServerStatus = 'connected' | 'disabled' | 'token_expired' | 'no_token';

export function getServerStatus(server: McpServerRecord): ServerStatus {
  if (!server.enabled) return 'disabled';
  if (server.auth_mode === 'oauth_pkce') {
    if (server.token_expires_at && new Date(server.token_expires_at) < new Date()) return 'token_expired';
    if (!server.token_expires_at && server.source_type === 'external') return 'no_token';
  }
  return 'connected';
}

export const statusColors: Record<ServerStatus, string> = {
  connected: 'bg-green-500',
  disabled: 'bg-zinc-400',
  token_expired: 'bg-amber-500',
  no_token: 'bg-amber-500',
};

export function ServerCard({
  server,
  onToggle,
  onDelete,
  fetchServerTools,
}: {
  server: McpServerRecord;
  onToggle: () => void;
  onDelete: () => void;
  fetchServerTools: (serverId: string) => Promise<{ name: string; description: string }[]>;
}) {
  const { t } = useI18n();
  const status = getServerStatus(server);
  const [expanded, setExpanded] = useState(false);
  const [tools, setTools] = useState<{ name: string; description: string }[] | null>(null);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);

  const handleToggleExpand = async () => {
    if (!expanded && tools === null && !toolsLoading) {
      setToolsLoading(true);
      setToolsError(null);
      try {
        const result = await fetchServerTools(server.id);
        setTools(result);
      } catch (err) {
        setToolsError(err instanceof Error ? err.message : t('mcpFetchToolsFailed'));
      } finally {
        setToolsLoading(false);
      }
    }
    setExpanded((prev) => !prev);
  };

  const handleRefreshTools = async () => {
    setToolsLoading(true);
    setToolsError(null);
    try {
      const result = await fetchServerTools(server.id);
      setTools(result);
    } catch (err) {
      setToolsError(err instanceof Error ? err.message : t('mcpFetchToolsFailed'));
    } finally {
      setToolsLoading(false);
    }
  };

  const statusLabel: Record<ServerStatus, string> = {
    connected: t('mcpStatusConnected'),
    disabled: t('mcpStatusDisabled'),
    token_expired: t('mcpStatusTokenExpired'),
    no_token: t('mcpStatusNoToken'),
  };

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors">
      <div className="flex items-center gap-4 p-4">
        {/* Server icon with status dot */}
        <div className="relative w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 flex-shrink-0">
          <Icons.Server className="w-5 h-5" />
          <span
            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-zinc-900 ${statusColors[status]}`}
            title={statusLabel[status]}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">{server.name}</h4>
            <span className="px-2 py-0.5 text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 rounded">
              {server.source_type}
            </span>
            <span className="px-2 py-0.5 text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 rounded">
              {server.auth_mode}
            </span>
            {tools && !toolsLoading && (
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                {t('mcpToolCount', { count: tools.length })}
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">{server.url}</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Expand toggle */}
          <button
            onClick={handleToggleExpand}
            className="p-2 rounded-lg bg-transparent border-none cursor-pointer transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 dark:text-zinc-500"
            title={t('mcpServerTools')}
          >
            {expanded
              ? <Icons.ChevronDown className="w-4 h-4" />
              : <Icons.ChevronRight className="w-4 h-4" />}
          </button>

          <button
            onClick={onToggle}
            className="p-2 rounded-lg bg-transparent border-none cursor-pointer transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title={server.enabled ? t('disable') : t('enable')}
          >
            {server.enabled ? (
              <Icons.ToggleOn className="w-6 h-6 text-emerald-500" />
            ) : (
              <Icons.ToggleOff className="w-6 h-6 text-zinc-300 dark:text-zinc-600" />
            )}
          </button>
          {server.managed ? null : (
            <Button variant="ghost" size="sm" onClick={onDelete}>
              {t('remove')}
            </Button>
          )}
        </div>
      </div>

      {/* Tools section */}
      {expanded && (
        <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t('mcpServerTools')}</span>
            <button
              onClick={handleRefreshTools}
              disabled={toolsLoading}
              className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-400 dark:text-zinc-500 disabled:opacity-50"
              title={t('mcpRefreshTools')}
            >
              <Icons.RefreshCw className={`w-3.5 h-3.5 ${toolsLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {toolsLoading && !tools && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500 italic">{t('mcpFetchingTools')}</p>
          )}

          {toolsError && (
            <div className="flex items-center gap-2">
              <p className="text-xs text-red-500">{toolsError}</p>
              <button
                onClick={handleRefreshTools}
                className="text-xs text-blue-500 hover:underline"
              >
                {t('retry')}
              </button>
            </div>
          )}

          {status === 'token_expired' && (
            <p className="text-xs text-amber-500 mb-2">{t('mcpReauthorize')}</p>
          )}

          {tools && tools.length === 0 && !toolsLoading && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500">{t('mcpNoTools')}</p>
          )}

          {tools && tools.length > 0 && (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {tools.map((tool) => (
                <div key={tool.name} className="flex items-start gap-2 py-1">
                  <Icons.Wrench className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <span className="text-xs font-mono font-medium text-zinc-700 dark:text-zinc-300">{tool.name}</span>
                    {tool.description && (
                      <p className="text-xs text-zinc-400 dark:text-zinc-500 line-clamp-2 mt-0.5">{tool.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
