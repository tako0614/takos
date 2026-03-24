import { useState, useEffect, type FormEvent } from 'react';
import { Icons } from '../../../lib/Icons';
import { useToast } from '../../../hooks/useToast';
import { formatShortDate } from '../../../lib/format';
import { useConfirmDialog } from '../../../providers/ConfirmDialogProvider';
import { useI18n } from '../../../providers/I18nProvider';
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

export function ReleaseList({ repoId }: ReleaseListProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingRelease, setEditingRelease] = useState<Release | null>(null);

  const [formTag, setFormTag] = useState('');
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formIsPrerelease, setFormIsPrerelease] = useState(false);
  const [formIsDraft, setFormIsDraft] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchReleases();
  }, [repoId]);

  const fetchReleases = async () => {
    try {
      setLoading(true);
      const res = await rpc.repos[':repoId'].releases.$get({
        param: { repoId },
      });
      const data = await rpcJson<{ releases?: Release[] }>(res);
      setReleases(data.releases || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('unknownError'));
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormTag('');
    setFormName('');
    setFormDescription('');
    setFormIsPrerelease(false);
    setFormIsDraft(false);
    setEditingRelease(null);
  };

  const openCreateModal = () => {
    resetForm();
    setShowCreateModal(true);
  };

  const openEditModal = (release: Release) => {
    setFormTag(release.tag);
    setFormName(release.name || '');
    setFormDescription(release.description || '');
    setFormIsPrerelease(release.is_prerelease);
    setFormIsDraft(release.is_draft);
    setEditingRelease(release);
    setShowCreateModal(true);
  };

  const closeModal = () => {
    setShowCreateModal(false);
    resetForm();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!formTag.trim()) return;

    setSaving(true);
    try {
      const body = {
        tag: formTag.trim(),
        name: formName.trim() || null,
        description: formDescription.trim() || null,
        is_prerelease: formIsPrerelease,
        is_draft: formIsDraft,
      };

      if (editingRelease) {
        const res = await rpc.repos[':repoId'].releases[':tag'].$patch({
          param: { repoId, tag: editingRelease.tag },
          json: body,
        });
        await rpcJson(res);
      } else {
        const res = await rpc.repos[':repoId'].releases.$post({
          param: { repoId },
          json: body,
        });
        await rpcJson(res);
      }

      closeModal();
      fetchReleases();
    } catch (err) {
      console.error('Failed to save release:', err);
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
        param: { repoId, tag: release.tag },
      });
      await rpcJson(res);
      fetchReleases();
    } catch (err) {
      console.error('Failed to delete release:', err);
      showToast('error', t('failedToDeleteRelease'));
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500">
        <div className="w-8 h-8 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
        <span>{t('loadingReleases')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500">
        <Icons.AlertTriangle className="w-12 h-12 text-zinc-700" />
        <span className="text-zinc-700">{error}</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => fetchReleases()}
        >
          {t('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ backgroundColor: 'var(--color-surface-primary)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--color-border-primary)', backgroundColor: 'var(--color-bg-secondary)' }}>
        <div className="flex items-center gap-2">
          <Icons.Tag className="w-4 h-4 text-zinc-500" />
          <span className="text-sm text-zinc-500">{t('releasesCount', { count: releases.length })}</span>
        </div>
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Icons.Plus className="w-4 h-4" />}
          onClick={openCreateModal}
        >
          {t('newRelease')}
        </Button>
      </div>

      {releases.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500">
          <Icons.Tag className="w-12 h-12 text-zinc-400" />
          <p className="text-zinc-700">{t('noReleasesYet')}</p>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Icons.Plus className="w-4 h-4" />}
            onClick={openCreateModal}
          >
            {t('createFirstRelease')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col">
          {releases.map((release, index) => (
            <div
              key={release.id}
              className="flex items-start gap-4 px-4 py-4 border-b hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              style={{ borderColor: 'var(--color-border-primary)' }}
            >
              <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                <Icons.Tag className="w-5 h-5" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    {release.name || release.tag}
                  </h3>
                  {index === 0 && !release.is_prerelease && !release.is_draft && (
                    <Badge variant="default" size="sm" style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-text-inverted)' }}>
                      {t('latest')}
                    </Badge>
                  )}
                  {release.is_prerelease && (
                    <Badge variant="default" size="sm" style={{ backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-secondary)' }}>
                      {t('preRelease')}
                    </Badge>
                  )}
                  {release.is_draft && (
                    <Badge variant="default" size="sm" style={{ backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border-primary)' }}>
                      {t('draft')}
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-3 mt-1 text-sm text-zinc-500">
                  <span className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-xs border border-zinc-200 dark:border-zinc-700">
                    {release.tag}
                  </span>
                  {release.commit_sha && (
                    <span className="font-mono text-xs text-zinc-400">
                      {release.commit_sha.slice(0, 7)}
                    </span>
                  )}
                  <span>{formatShortDate(release.published_at || release.created_at)}</span>
                </div>

                {release.description && (
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 line-clamp-2">
                    {release.description}
                  </p>
                )}

                {release.downloads > 0 && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-zinc-500">
                    <Icons.Download className="w-3 h-3" />
                    <span>{t('downloadsCount', { count: release.downloads })}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  onClick={() => openEditModal(release)}
                  title={t('edit')}
                >
                  <Icons.Edit className="w-4 h-4" />
                </button>
                <button
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  onClick={() => handleDelete(release)}
                  title={t('delete')}
                >
                  <Icons.Trash className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={showCreateModal}
        onClose={closeModal}
        title={editingRelease ? t('editRelease') : t('createRelease')}
        size="md"
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('tagLabel')} *</label>
            <Input
              type="text"
              placeholder="v1.0.0"
              value={formTag}
              onChange={e => setFormTag(e.target.value)}
              required
              autoFocus
              disabled={!!editingRelease}
            />
            {editingRelease && (
              <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{t('tagCannotBeChanged')}</span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('releaseName')}</label>
            <Input
              type="text"
              placeholder="Version 1.0.0"
              value={formName}
              onChange={e => setFormName(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('description')}</label>
            <Textarea
              placeholder={t('releaseNotes')}
              value={formDescription}
              onChange={e => setFormDescription(e.target.value)}
              rows={5}
              resize="vertical"
            />
          </div>

          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formIsPrerelease}
                onChange={e => setFormIsPrerelease(e.target.checked)}
                className="w-4 h-4 rounded accent-zinc-900"
                style={{ borderColor: 'var(--color-border-primary)' }}
              />
              <div>
                <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{t('preRelease')}</span>
                <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{t('markAsPreRelease')}</p>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formIsDraft}
                onChange={e => setFormIsDraft(e.target.checked)}
                className="w-4 h-4 rounded accent-zinc-900"
                style={{ borderColor: 'var(--color-border-primary)' }}
              />
              <div>
                <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{t('draft')}</span>
                <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{t('saveDraftHint')}</p>
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
              disabled={saving || !formTag.trim()}
              isLoading={saving}
            >
              {editingRelease ? t('updateRelease') : t('createRelease')}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
