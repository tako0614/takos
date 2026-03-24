import { Button } from '../../components/ui/Button';
import { Modal, ModalFooter } from '../../components/ui/Modal';
import { useI18n, type I18nContextType } from '../../providers/I18nProvider';
import { useTakopacks } from '../../hooks/useTakopacks';
import { Icons } from '../../lib/Icons';
import { formatDateTime } from '../../lib/format';
import type { Takopack, TakopackDetail } from '../../types';

export interface AppsPageProps {
  spaceId: string;
  onNavigateToStore?: () => void;
}

function getSourceLabel(takopack: Takopack, t: I18nContextType['t']) {
  if (takopack.sourceType === 'git') return t('sourceTypeGit');
  return t('sourceTypeUnknown');
}

function AppCard({
  takopack,
  onOpen,
}: {
  takopack: Takopack;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
    >
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-lg dark:bg-zinc-800">
        {takopack.icon || '📦'}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {takopack.name}
        </h2>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          v{takopack.version}
        </div>
      </div>
      <Icons.ChevronRight className="h-4 w-4 flex-shrink-0 text-zinc-400 dark:text-zinc-500" />
    </button>
  );
}

export function AppsPage({ spaceId, onNavigateToStore }: AppsPageProps) {
  const { t } = useI18n();
  const {
    takopacks,
    loading,
    selectedTakopack,
    setSelectedTakopack,
    getTakopackDetail,
    uninstall,
    rollback,
  } = useTakopacks({ spaceId });

  const handleCardClick = async (takopack: Takopack) => {
    await getTakopackDetail(takopack.id);
  };

  const handleUninstall = async () => {
    if (!selectedTakopack) return;
    await uninstall(selectedTakopack.id, selectedTakopack.name);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-900">
      <div className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-8">
          <div className="flex items-center justify-between pb-6">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {t('apps')}
            </h1>
            <div className="flex gap-2">
              {onNavigateToStore ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onNavigateToStore}
                  leftIcon={<Icons.ShoppingBag className="h-4 w-4" />}
                >
                  {t('browseStore')}
                </Button>
              ) : null}
            </div>
          </div>

          {loading ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-zinc-500 dark:text-zinc-400">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-700 dark:border-t-zinc-300" />
              <span className="text-sm">{t('loading')}</span>
            </div>
          ) : takopacks.length === 0 ? (
            <div className="mt-6 rounded-[2rem] border border-dashed border-zinc-300 bg-white px-6 py-12 text-center dark:border-zinc-700 dark:bg-zinc-900">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
                <Icons.Package className="h-8 w-8" />
              </div>
              <h2 className="mt-5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {t('appsInstalledEmpty')}
              </h2>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                {t('appsInstalledEmptyDesc')}
              </p>
              {onNavigateToStore ? (
                <div className="mt-5">
                  <Button onClick={onNavigateToStore} leftIcon={<Icons.ShoppingBag className="h-4 w-4" />}>
                    {t('browseStore')}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {takopacks.map((takopack) => (
                <AppCard
                  key={takopack.id}
                  takopack={takopack}
                  onOpen={() => void handleCardClick(takopack)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedTakopack ? (
        <InstalledAppDetailModal
          takopack={selectedTakopack}
          onClose={() => setSelectedTakopack(null)}
          onUninstall={() => void handleUninstall()}
          onRollback={() => void rollback(selectedTakopack.id, selectedTakopack.name)}
        />
      ) : null}
    </div>
  );
}

function InstalledAppDetailModal({
  takopack,
  onClose,
  onUninstall,
  onRollback,
}: {
  takopack: TakopackDetail;
  onClose: () => void;
  onUninstall: () => void;
  onRollback: () => void;
}) {
  const { t } = useI18n();
  const sourceLabel = getSourceLabel(takopack, t);

  return (
    <Modal isOpen onClose={onClose} title={takopack.name} size="md">
      <div className="space-y-6">
        <div className="flex items-start gap-4">
          <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-3xl bg-zinc-100 text-3xl dark:bg-zinc-800">
            {takopack.icon || '📦'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
              v{takopack.version}
            </div>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              {takopack.description || t('noDescription')}
            </p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-zinc-50 p-3 dark:bg-zinc-800/60">
                <dt className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                  {t('installed')}
                </dt>
                <dd className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">
                  {formatDateTime(takopack.installedAt)}
                </dd>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-3 dark:bg-zinc-800/60">
                <dt className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                  {t('source')}
                </dt>
                <dd className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">
                  {sourceLabel}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onRollback}
            leftIcon={<Icons.Refresh className="h-4 w-4" />}
          >
            {t('rollback')}
          </Button>
        </div>

        <section className="grid gap-3 sm:grid-cols-3">
          <InfoCard title={t('shortcutGroups')} value={takopack.groups.length} />
          <InfoCard title={t('uiExtensions')} value={takopack.uiExtensions.length} />
          <InfoCard title={t('mcpServers')} value={takopack.mcpServers.length} />
        </section>
      </div>

      <ModalFooter className="-mx-6 -mb-6 mt-6">
        <Button variant="ghost" onClick={onClose}>
          {t('close')}
        </Button>
        <Button
          variant="danger"
          onClick={onUninstall}
          leftIcon={<Icons.Trash className="h-4 w-4" />}
        >
          {t('uninstall')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function InfoCard({ title, value }: { title: string; value: number }) {
  return (
    <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-800/60">
      <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
        {title}
      </div>
      <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
    </div>
  );
}
