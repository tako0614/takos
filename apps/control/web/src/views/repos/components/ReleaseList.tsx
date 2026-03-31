import { createSignal, createEffect, on, Show, For } from 'solid-js';
import type { JSX } from 'solid-js';
import { Icons } from '../../../lib/Icons';
import { useToast } from '../../../store/toast';
import { formatShortDate } from '../../../lib/format';
import { useConfirmDialog } from '../../../store/confirm-dialog';
import { useI18n } from '../../../store/i18n';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { Card } from '../../../components/ui/Card';
import { Modal, ModalFooter } from '../../../components/ui/Modal';
import { Input } from '../../../components/ui/Input';
import { Textarea } from '../../../components/ui/Textarea';
import { rpc, rpcJson } from '../../../lib/rpc';

interface Release {
  id: string;
  tag: string;
  name: string | null;
  description: string | null;
  commit_sha: string | null;
  is_prerelease: boolean;
  is_draft: boolean;
  downloads: number;
  author_id: string | null;
  published_at: string | null;
  created_at: string;
}

interface ReleaseListProps {
  repoId: string;
}

interface FormData {
  tag: string;
  name: string;
  description: string;
  isPrerelease: boolean;
  isDraft: boolean;
}

const initialFormData: FormData = {
  tag: '',
  name: '',
  description: '',
  isPrerelease: false,
  isDraft: false,
};

export function ReleaseList(props: ReleaseListProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const [releases, setReleases] = createSignal<Release[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [showCreateModal, setShowCreateModal] = createSignal(false);
  const [editingRelease, setEditingRelease] = createSignal<Release | null>(null);
  const [formData, setFormData] = createSignal<FormData>(initialFormData);
  const [saving, setSaving] = createSignal(false);

  const fetchReleases = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await rpc.repos[':repoId'].releases.$get({
        param: { repoId: props.repoId },
      });
      const data = await rpcJson<{ releases?: Release[] }>(res);
      setReleases(data.releases || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('unknownError'));
    } finally {
      setLoading(false);
    }
  };

  createEffect(on(() => props.repoId, () => {
    fetchReleases();
  }));

  const resetForm = () => {
    setFormData(initialFormData);
    setEditingRelease(null);
  };

  const openCreateModal = () => {
    resetForm();
    setShowCreateModal(true);
  };

  const openEditModal = (release: Release) => {
    setFormData({
      tag: release.tag,
      name: release.name || '',
      description: release.description || '',
      isPrerelease: release.is_prerelease,
      isDraft: release.is_draft,
    });
    setEditingRelease(release);
    setShowCreateModal(true);
  };

  const closeModal = () => {
    setShowCreateModal(false);
    resetForm();
  };

  const handleSubmit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = async (e) => {
    e.preventDefault();
    const fd = formData();
    if (!fd.tag.trim()) return;

    setSaving(true);
    try {
      const body = {
        tag: fd.tag.trim(),
        name: fd.name.trim() || null,
        description: fd.description.trim() || null,
        is_prerelease: fd.isPrerelease,
        is_draft: fd.isDraft,
      };

      const editing = editingRelease();
      if (editing) {
        const res = await rpc.repos[':repoId'].releases[':tag'].$patch({
          param: { repoId: props.repoId, tag: editing.tag },
          json: body,
        });
        await rpcJson(res);
      } else {
        const res = await rpc.repos[':repoId'].releases.$post({
          param: { repoId: props.repoId },
          json: body,
        });
        await rpcJson(res);
      }

      closeModal();
      fetchReleases();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('failedToSaveRelease'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (release: Release) => {
    const confirmed = await confirm({
      title: t('deleteRelease'),
      message: t('deleteReleaseConfirm', { tag: release.tag }),
      confirmText: t('delete'),
      danger: true,
    });
    if (!confirmed) return;

    try {
      const res = await rpc.repos[':repoId'].releases[':tag'].$delete({
        param: { repoId: props.repoId, tag: release.tag },
      });
      await rpcJson(res);
      fetchReleases();
    } catch {
      showToast('error', t('failedToDeleteRelease'));
    }
  };

  return (
    <>
      <Show when={loading()}>
        <div class="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500">
          <div class="w-8 h-8 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
          <span>{t('loadingReleases')}</span>
        </div>
      </Show>

      <Show when={!loading() && error()}>
        <div class="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500">
          <Icons.AlertTriangle class="w-12 h-12 text-zinc-700" />
          <span class="text-zinc-700">{error()}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fetchReleases()}
          >
            {t('retry')}
          </Button>
        </div>
      </Show>

      <Show when={!loading() && !error()}>
        <div class="flex flex-col" style={{ "background-color": 'var(--color-surface-primary)' }}>
          <div class="flex items-center justify-between px-4 py-3 border-b" style={{ "border-color": 'var(--color-border-primary)', "background-color": 'var(--color-bg-secondary)' }}>
            <div class="flex items-center gap-2">
              <Icons.Tag class="w-4 h-4 text-zinc-500" />
              <span class="text-sm text-zinc-500">{t('releasesCount', { count: releases().length })}</span>
            </div>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Icons.Plus class="w-4 h-4" />}
              onClick={openCreateModal}
            >
              {t('newRelease')}
            </Button>
          </div>

          <Show when={releases().length === 0}>
            <div class="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500">
              <Icons.Tag class="w-12 h-12 text-zinc-400" />
              <p class="text-zinc-700">{t('noReleasesYet')}</p>
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Icons.Plus class="w-4 h-4" />}
                onClick={openCreateModal}
              >
                {t('createFirstRelease')}
              </Button>
            </div>
          </Show>

          <Show when={releases().length > 0}>
            <div class="flex flex-col">
              <For each={releases()}>{(release, index) => (
                <div
                  class="flex items-start gap-4 px-4 py-4 border-b hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  style={{ "border-color": 'var(--color-border-primary)' }}
                >
                  <div class="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                    <Icons.Tag class="w-5 h-5" />
                  </div>

                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <h3 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                        {release.name || release.tag}
                      </h3>
                      <Show when={index() === 0 && !release.is_prerelease && !release.is_draft}>
                        <Badge variant="default" size="sm" style={{ "background-color": 'var(--color-primary)', color: 'var(--color-text-inverted)' }}>
                          {t('latest')}
                        </Badge>
                      </Show>
                      <Show when={release.is_prerelease}>
                        <Badge variant="default" size="sm" style={{ "background-color": 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-secondary)' }}>
                          {t('preRelease')}
                        </Badge>
                      </Show>
                      <Show when={release.is_draft}>
                        <Badge variant="default" size="sm" style={{ "background-color": 'var(--color-bg-tertiary)', color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border-primary)' }}>
                          {t('draft')}
                        </Badge>
                      </Show>
                    </div>

                    <div class="flex items-center gap-3 mt-1 text-sm text-zinc-500">
                      <span class="font-mono bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-xs border border-zinc-200 dark:border-zinc-700">
                        {release.tag}
                      </span>
                      <Show when={release.commit_sha}>
                        <span class="font-mono text-xs text-zinc-400">
                          {release.commit_sha!.slice(0, 7)}
                        </span>
                      </Show>
                      <span>{formatShortDate(release.published_at || release.created_at)}</span>
                    </div>

                    <Show when={release.description}>
                      <p class="mt-2 text-sm text-zinc-600 dark:text-zinc-400 line-clamp-2">
                        {release.description}
                      </p>
                    </Show>

                    <Show when={release.downloads > 0}>
                      <div class="flex items-center gap-1 mt-2 text-xs text-zinc-500">
                        <Icons.Download class="w-3 h-3" />
                        <span>{t('downloadsCount', { count: release.downloads })}</span>
                      </div>
                    </Show>
                  </div>

                  <div class="flex items-center gap-2 flex-shrink-0">
                    <button
                      class="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                      onClick={() => openEditModal(release)}
                      title={t('edit')}
                    >
                      <Icons.Edit class="w-4 h-4" />
                    </button>
                    <button
                      class="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                      onClick={() => handleDelete(release)}
                      title={t('delete')}
                    >
                      <Icons.Trash class="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}</For>
            </div>
          </Show>
        </div>
      </Show>

      <Modal
        isOpen={showCreateModal()}
        onClose={closeModal}
        title={editingRelease() ? t('editRelease') : t('createRelease')}
        size="md"
      >
        <form onSubmit={handleSubmit} class="flex flex-col gap-4">
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('tagLabel')} *</label>
            <Input
              type="text"
              placeholder="v1.0.0"
              value={formData().tag}
              onInput={(e: Event & { currentTarget: HTMLInputElement }) => setFormData(prev => ({ ...prev, tag: e.currentTarget.value }))}
              required
              autofocus
              disabled={!!editingRelease()}
            />
            <Show when={editingRelease()}>
              <span class="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{t('tagCannotBeChanged')}</span>
            </Show>
          </div>

          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('releaseName')}</label>
            <Input
              type="text"
              placeholder="Version 1.0.0"
              value={formData().name}
              onInput={(e: Event & { currentTarget: HTMLInputElement }) => setFormData(prev => ({ ...prev, name: e.currentTarget.value }))}
            />
          </div>

          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('description')}</label>
            <Textarea
              placeholder={t('releaseNotes')}
              value={formData().description}
              onInput={(e: Event & { currentTarget: HTMLTextAreaElement }) => setFormData(prev => ({ ...prev, description: e.currentTarget.value }))}
              rows={5}
              resize="vertical"
            />
          </div>

          <div class="flex flex-col gap-3">
            <label class="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData().isPrerelease}
                onInput={(e) => setFormData(prev => ({ ...prev, isPrerelease: e.currentTarget.checked }))}
                class="w-4 h-4 rounded accent-zinc-900"
                style={{ "border-color": 'var(--color-border-primary)' }}
              />
              <div>
                <span class="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{t('preRelease')}</span>
                <p class="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{t('markAsPreRelease')}</p>
              </div>
            </label>

            <label class="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData().isDraft}
                onInput={(e) => setFormData(prev => ({ ...prev, isDraft: e.currentTarget.checked }))}
                class="w-4 h-4 rounded accent-zinc-900"
                style={{ "border-color": 'var(--color-border-primary)' }}
              />
              <div>
                <span class="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{t('draft')}</span>
                <p class="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{t('saveDraftHint')}</p>
              </div>
            </label>
          </div>

          <ModalFooter style={{ margin: '1rem -1.5rem -1.5rem', padding: '1rem 1.5rem' }}>
            <Button
              type="button"
              variant="secondary"
              onClick={closeModal}
            >
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={saving() || !formData().tag.trim()}
              isLoading={saving()}
            >
              {editingRelease() ? t('updateRelease') : t('createRelease')}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </>
  );
}
