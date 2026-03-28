import { useState } from 'react';
import { Icons } from '../../lib/Icons';
import { useI18n } from '../../store/i18n';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';

const MCP_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

export function CreateMcpServerModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: { name: string; url: string; scope?: string }) => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [scope, setScope] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const nameError = name.length > 0 && !MCP_NAME_PATTERN.test(name) ? t('mcpNameInvalid') : null;

  let urlError: string | null = null;
  if (url.length > 0) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') {
        urlError = t('mcpUrlInvalid');
      }
    } catch {
      urlError = t('mcpUrlInvalid');
    }
  }

  const canSubmit = name.trim().length > 0 && url.trim().length > 0 && !nameError && !urlError;

  return (
    <Modal isOpen onClose={onClose} title={t('addMcpServer')} size="md">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!canSubmit) return;
          setSubmitting(true);
          try {
            await onCreate({
              name: name.trim(),
              url: url.trim(),
              scope: scope.trim() || undefined,
            });
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <label className="block">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('name')}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`mt-2 w-full h-11 rounded-xl border ${nameError ? 'border-red-400' : 'border-zinc-200 dark:border-zinc-700'} bg-white dark:bg-zinc-900 px-3 text-sm text-zinc-900 dark:text-zinc-100`}
            placeholder="github"
            required
          />
          {nameError && (
            <p className="mt-1 text-xs text-red-500">{nameError}</p>
          )}
        </label>
        <label className="block">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">URL</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className={`mt-2 w-full h-11 rounded-xl border ${urlError ? 'border-red-400' : 'border-zinc-200 dark:border-zinc-700'} bg-white dark:bg-zinc-900 px-3 text-sm text-zinc-900 dark:text-zinc-100`}
            placeholder="https://example.com/mcp"
            required
          />
          {urlError && (
            <p className="mt-1 text-xs text-red-500">{urlError}</p>
          )}
        </label>

        {/* Advanced toggle */}
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? <Icons.ChevronDown className="w-3 h-3" /> : <Icons.ChevronRight className="w-3 h-3" />}
          {t('mcpAdvanced')}
        </button>

        {showAdvanced && (
          <label className="block">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Scope</span>
            <input
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="mt-2 w-full h-11 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-sm text-zinc-900 dark:text-zinc-100"
              placeholder="read write"
            />
          </label>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} type="button">
            {t('cancel')}
          </Button>
          <Button type="submit" isLoading={submitting} disabled={!canSubmit}>
            {t('addMcpServer')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
