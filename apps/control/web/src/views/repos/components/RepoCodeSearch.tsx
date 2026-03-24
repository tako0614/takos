import { useEffect, useMemo, useState } from 'react';
import { Icons } from '../../../lib/Icons';
import { rpc, rpcJson } from '../../../lib/rpc';
import { useI18n } from '../../../providers/I18nProvider';

type SearchMatch = {
  path: string;
  line_number: number;
  column: number;
  snippet: string;
};

interface RepoCodeSearchProps {
  repoId: string;
  branch: string;
  onOpenFile: (path: string, line?: number) => void;
}

export function RepoCodeSearch({ repoId, branch, onOpenFile }: RepoCodeSearchProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [filesScanned, setFilesScanned] = useState(0);
  const [bytesScanned, setBytesScanned] = useState(0);

  const canSearch = useMemo(() => query.trim().length >= 2, [query]);

  useEffect(() => {
    if (!canSearch) {
      setMatches([]);
      setError(null);
      setTruncated(false);
      setFilesScanned(0);
      setBytesScanned(0);
      return;
    }

    const timer = setTimeout(() => {
      void (async () => {
        try {
          setLoading(true);
          setError(null);
          const res = await rpc.repos[':repoId'].search.$get({
            param: { repoId },
            query: { q: query.trim(), ref: branch, limit: '50' },
          });
          const data = await rpcJson<{
            matches?: SearchMatch[];
            truncated?: boolean;
            files_scanned?: number;
            bytes_scanned?: number;
          }>(res);

          setMatches(data.matches || []);
          setTruncated(!!data.truncated);
          setFilesScanned(data.files_scanned || 0);
          setBytesScanned(data.bytes_scanned || 0);
        } catch (err) {
          setError(err instanceof Error ? err.message : t('searchFailed'));
          setMatches([]);
        } finally {
          setLoading(false);
        }
      })();
    }, 250);

    return () => clearTimeout(timer);
  }, [repoId, branch, query, canSearch]);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900">
        <div className="relative flex-1 max-w-2xl">
          <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 dark:text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchInRepository')}
            className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:focus:ring-zinc-100/10"
          />
        </div>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          ref: <span className="font-mono">{branch}</span>
        </span>
      </div>

      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-500 dark:text-zinc-400">
            <div className="w-8 h-8 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
            <span className="mt-3">{t('searching')}</span>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-500 dark:text-zinc-400">
            <Icons.AlertTriangle className="w-10 h-10 text-zinc-700 dark:text-zinc-300" />
            <span className="mt-3 text-zinc-700 dark:text-zinc-300">{error}</span>
          </div>
        )}

        {!loading && !error && !canSearch && (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-500 dark:text-zinc-400">
            <Icons.Search className="w-10 h-10 text-zinc-400" />
            <span className="mt-3">{t('typeAtLeast2Chars')}</span>
          </div>
        )}

        {!loading && !error && canSearch && matches.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-500 dark:text-zinc-400">
            <Icons.Search className="w-10 h-10 text-zinc-400" />
            <span className="mt-3">{t('noMatches')}</span>
            <span className="mt-1 text-xs">
              {t('scannedStats', { files: filesScanned, size: formatBytes(bytesScanned) })}
            </span>
          </div>
        )}

        {!loading && !error && matches.length > 0 && (
          <div className="flex flex-col">
            <div className="px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700">
              {t('matchesCount', { count: matches.length })}
              {truncated ? ` ${t('truncatedLabel')}` : ''}
              <span className="ml-2">
                {t('scannedStats', { files: filesScanned, size: formatBytes(bytesScanned) })}
              </span>
            </div>
            {matches.map((m, idx) => (
              <button
                key={`${m.path}:${m.line_number}:${m.column}:${idx}`}
                className="flex flex-col gap-1 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-left"
                onClick={() => onOpenFile(m.path, m.line_number)}
              >
                <div className="flex items-center gap-2 text-sm">
                  <code className="text-zinc-700 dark:text-zinc-300 font-mono truncate">{m.path}</code>
                  <span className="text-zinc-400">:</span>
                  <span className="text-zinc-500 dark:text-zinc-400 font-mono text-xs">
                    {m.line_number}:{m.column}
                  </span>
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono whitespace-pre-wrap break-words">
                  {m.snippet}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
