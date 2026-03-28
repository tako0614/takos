import { useState } from 'react';
import { Icons } from '../../lib/Icons';
import { useI18n } from '../../store/i18n';
import { useToast } from '../../store/toast';
import { useMcpServers } from '../../hooks/useMcpServers';
import { Button } from '../../components/ui/Button';
import type { Space } from '../../types';
import { ServerCard } from './ServerCard';
import { CreateMcpServerModal } from './CreateMcpServerModal';

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
  const [showCreateModal, setShowCreateModal] = useState(false);

  if (!selectedSpaceId) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="w-16 h-16 rounded-2xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center">
          <Icons.Server className="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
        </div>
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{t('selectSpace')}</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('mcpServers')}</h4>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('mcpServersDescription')}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedSpaceId}
            onChange={(e) => setSelectedSpaceId(e.target.value)}
            className="h-10 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-sm text-zinc-900 dark:text-zinc-100"
          >
            {spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Icons.Plus className="w-4 h-4" />}
            onClick={() => setShowCreateModal(true)}
          >
            {t('addMcpServer')}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="w-8 h-8 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-600 dark:border-t-zinc-300 rounded-full animate-spin" />
          <span className="text-sm text-zinc-400">{t('loading')}</span>
        </div>
      ) : servers.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="w-16 h-16 rounded-2xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center">
            <Icons.Server className="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{t('noMcpServersYet')}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">{t('managedMcpServersAutoConnected')}</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              onToggle={() => toggleServer(server)}
              onDelete={() => deleteServer(server)}
              fetchServerTools={fetchServerTools}
            />
          ))}
        </div>
      )}

      {showCreateModal && (
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
