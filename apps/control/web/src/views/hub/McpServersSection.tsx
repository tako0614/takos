import { createSignal } from 'solid-js';
import { Icons } from '../../lib/Icons.tsx';
import { useI18n } from '../../store/i18n.ts';
import { useToast } from '../../store/toast.ts';
import { useMcpServers } from '../../hooks/useMcpServers.ts';
import { Button } from '../../components/ui/Button.tsx';
import type { Space, McpServerRecord } from '../../types/index.ts';
import { ServerCard } from './ServerCard.tsx';
import { CreateMcpServerModal } from './CreateMcpServerModal.tsx';

interface McpServersSectionProps {
  spaces: Space[];
  selectedSpaceId: string | null;
  setSelectedSpaceId: (id: string) => void;
}

export function McpServersSection({
  spaces,
  selectedSpaceId,
  setSelectedSpaceId,
}: McpServersSectionProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const spaceId = selectedSpaceId || '';
  const { servers, loading, createExternalServer, toggleServer, deleteServer, fetchServerTools } = useMcpServers({ spaceId });
  const [showCreateModal, setShowCreateModal] = createSignal(false);

  if (!selectedSpaceId) {
    return (
      <div class="flex flex-col items-center justify-center h-64 gap-4">
        <div class="w-16 h-16 rounded-2xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center">
          <Icons.Server class="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
        </div>
        <p class="text-sm font-medium text-zinc-600 dark:text-zinc-400">{t('selectSpace')}</p>
      </div>
    );
  }

  return (
    <>
      <div class="flex items-center justify-between gap-4 mb-4">
        <div>
          <h4 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('mcpServers')}</h4>
          <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('mcpServersDescription')}</p>
        </div>
        <div class="flex items-center gap-2">
          <select
            value={selectedSpaceId}
            onChange={(e) => setSelectedSpaceId(e.target.value)}
            class="h-10 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-sm text-zinc-900 dark:text-zinc-100"
          >
            {spaces.map((space) => (
              <option value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Icons.Plus class="w-4 h-4" />}
            onClick={() => setShowCreateModal(true)}
          >
            {t('addMcpServer')}
          </Button>
        </div>
      </div>

      {loading() ? (
        <div class="flex flex-col items-center justify-center h-64 gap-4">
          <div class="w-8 h-8 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-600 dark:border-t-zinc-300 rounded-full animate-spin" />
          <span class="text-sm text-zinc-400">{t('loading')}</span>
        </div>
      ) : servers().length === 0 ? (
        <div class="flex flex-col items-center justify-center h-64 gap-4">
          <div class="w-16 h-16 rounded-2xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center">
            <Icons.Server class="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
          </div>
          <div class="text-center">
            <p class="text-sm font-medium text-zinc-600 dark:text-zinc-400">{t('noMcpServersYet')}</p>
            <p class="text-xs text-zinc-500 dark:text-zinc-500 mt-1">{t('managedMcpServersAutoConnected')}</p>
          </div>
        </div>
      ) : (
        <div class="grid gap-3">
          {servers().map((server: McpServerRecord) => (
            <ServerCard

              server={server}
              onToggle={() => toggleServer(server)}
              onDelete={() => deleteServer(server)}
              fetchServerTools={fetchServerTools}
            />
          ))}
        </div>
      )}

      {showCreateModal() && (
        <CreateMcpServerModal
          onClose={() => setShowCreateModal(false)}
          onCreate={async (input) => {
            const result = await createExternalServer(input);
            showToast('success', result.message);
            if (result.auth_url) {
              window.open(result.auth_url, '_blank', 'noopener,noreferrer');
            }
            setShowCreateModal(false);
          }}
        />
      )}
    </>
  );
}
