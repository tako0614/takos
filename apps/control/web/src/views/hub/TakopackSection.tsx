import { useEffect } from 'react';
import { Icons } from '../../lib/Icons';
import { useI18n } from '../../providers/I18nProvider';
import { useTakopacks } from '../../hooks/useTakopacks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Modal, ModalFooter } from '../../components/ui/Modal';
import type { Workspace, Takopack, TakopackDetail } from '../../types';

interface TakopackSectionProps {
  workspaces: Workspace[];
  selectedWorkspaceId: string | null;
  setSelectedWorkspaceId: (id: string) => void;
}

export function TakopackSection({
  workspaces,
  selectedWorkspaceId,
  setSelectedWorkspaceId,
}: TakopackSectionProps) {
  void workspaces;
  void setSelectedWorkspaceId;
  const { t } = useI18n();
  const spaceId = selectedWorkspaceId || '';

  const {
    takopacks,
    loading,
    selectedTakopack,
    setSelectedTakopack,
    refresh,
    getTakopackDetail,
    uninstall,
    rollback,
  } = useTakopacks({ spaceId });

  useEffect(() => {
    if (selectedWorkspaceId) {
      void refresh();
    }
  }, [selectedWorkspaceId, refresh]);

  const handleCardClick = async (takopack: Takopack) => {
    await getTakopackDetail(takopack.id);
  };

  const handleUninstall = async () => {
    if (selectedTakopack) {
      await uninstall(selectedTakopack.id, selectedTakopack.name);
    }
  };

  return (
    <>
      {loading ? (
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="w-8 h-8 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-600 dark:border-t-zinc-300 rounded-full animate-spin" />
          <span className="text-sm text-zinc-400">{t('loading')}</span>
        </div>
      ) : takopacks.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="w-16 h-16 rounded-2xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center">
            <Icons.Package className="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{t('noTakopacksInstalled')}</p>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 m-0">
            Deploy `.takopack` bundles from a repository release asset in Source.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {takopacks.map((takopack) => (
              <Card
                key={takopack.id}
                padding="none"
                className="cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors"
                onClick={() => void handleCardClick(takopack)}
              >
                <div className="p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0">
                      {takopack.icon ? (
                        <span className="text-xl">{takopack.icon}</span>
                      ) : (
                        <Icons.Folder className="w-5 h-5 text-zinc-500 dark:text-zinc-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 m-0 truncate">
                        {takopack.name}
                      </h4>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 m-0">
                        v{takopack.version}
                      </p>
                    </div>
                    <Icons.ChevronRight className="w-4 h-4 text-zinc-400 dark:text-zinc-500 flex-shrink-0" />
                  </div>
                  {takopack.description ? (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 m-0 line-clamp-2">
                      {takopack.description}
                    </p>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {selectedTakopack ? (
        <TakopackDetailModal
          takopack={selectedTakopack}
          onClose={() => setSelectedTakopack(null)}
          onUninstall={handleUninstall}
          onRollback={() => void rollback(selectedTakopack.id, selectedTakopack.name)}
        />
      ) : null}
    </>
  );
}

interface TakopackDetailModalProps {
  takopack: TakopackDetail;
  onClose: () => void;
  onUninstall: () => void;
  onRollback: () => void;
}

function TakopackDetailModal({
  takopack,
  onClose,
  onUninstall,
  onRollback,
}: TakopackDetailModalProps) {
  const { t } = useI18n();

  return (
    <Modal isOpen onClose={onClose} title={takopack.name} size="md">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onRollback}
            leftIcon={<Icons.Refresh className="w-4 h-4" />}
          >
            {t('rollback')}
          </Button>
        </div>

        <div className="space-y-2">
          <p className="text-sm text-zinc-500 dark:text-zinc-400 m-0">
            {t('version')}: {takopack.version}
          </p>
          {takopack.description ? (
            <p className="text-sm text-zinc-700 dark:text-zinc-300 m-0">
              {takopack.description}
            </p>
          ) : null}
          <p className="text-xs text-zinc-400 dark:text-zinc-500 m-0">
            {t('installed')}: {new Date(takopack.installedAt).toLocaleDateString()}
          </p>
        </div>

        {takopack.groups.length > 0 ? (
          <div>
            <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 m-0 mb-2">
              {t('shortcutGroups')} ({takopack.groups.length})
            </h4>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 m-0">
              {takopack.groups.map((group) => group.name).join(', ')}
            </p>
          </div>
        ) : null}

        {takopack.uiExtensions.length > 0 ? (
          <div>
            <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 m-0 mb-2">
              {t('uiExtensions')} ({takopack.uiExtensions.length})
            </h4>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 m-0">
              {takopack.uiExtensions.map((extension) => extension.label || extension.path).join(', ')}
            </p>
          </div>
        ) : null}

        {takopack.mcpServers.length > 0 ? (
          <div>
            <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 m-0 mb-2">
              {t('mcpServers')} ({takopack.mcpServers.length})
            </h4>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 m-0">
              {takopack.mcpServers.map((server) => server.name).join(', ')}
            </p>
          </div>
        ) : null}
      </div>

      <ModalFooter className="-mx-6 -mb-6 mt-6">
        <Button variant="ghost" onClick={onClose}>
          {t('close')}
        </Button>
        <Button
          variant="danger"
          onClick={onUninstall}
          leftIcon={<Icons.Trash className="w-4 h-4" />}
        >
          {t('uninstall')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
