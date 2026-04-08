import { createSignal, createEffect, on, Show, For } from 'solid-js';
import { useI18n } from '../../../store/i18n.ts';
import { rpcJson } from '../../../lib/rpc.ts';

interface ConflictFile {
  path: string;
  type: 'content' | 'delete-modify' | 'add-add';
  base: string | null;
  ours: string | null;
  theirs: string | null;
}

interface ConflictsResponse {
  conflicts: ConflictFile[];
  merge_base: string | null;
  is_mergeable: boolean;
  base_sha?: string;
  head_sha?: string;
}

interface Resolution {
  path: string;
  content: string;
  delete?: boolean;
  source: 'ours' | 'theirs' | 'manual';
}

interface ConflictResolverProps {
  repoId: string;
  prNumber: number;
  baseBranch: string;
  headBranch: string;
  onResolved: () => void;
  onCancel: () => void;
}

export function ConflictResolver(props: ConflictResolverProps) {
  const { t } = useI18n();

  const [conflicts, setConflicts] = createSignal<ConflictFile[]>([]);
  const [resolutions, setResolutions] = createSignal<Map<string, Resolution>>(new Map());
  const [selectedFile, setSelectedFile] = createSignal<string | null>(null);
  const [editContent, setEditContent] = createSignal('');
  const [loading, setLoading] = createSignal(true);
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const fetchConflicts = async () => {
    setLoading(true);
    setError(null);
    try {
      // Raw fetch is used here because the `/api/repos/:repoId/pulls/:n/conflicts`
      // route is not yet in the Hono rpc schema. `rpcJson` still gives us
      // 401 redirect handling and consistent error envelope parsing.
      const res = await fetch(`/api/repos/${props.repoId}/pulls/${props.prNumber}/conflicts`);
      const data = await rpcJson<ConflictsResponse>(res);
      if (data.is_mergeable) {
        setError(t('noConflictsToResolve'));
        return;
      }
      setConflicts(data.conflicts);
      setResolutions(new Map());
      const first = data.conflicts[0] ?? null;
      setSelectedFile(first?.path ?? null);
      setEditContent(first ? (first.ours || first.theirs || '') : '');
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('failedToLoadConflicts'));
    } finally {
      setLoading(false);
    }
  };

  createEffect(on(
    () => [props.repoId, props.prNumber],
    () => { fetchConflicts(); },
  ));

  const selectFile = (path: string) => {
    const res = resolutions().get(path);
    const conflict = conflicts().find(c => c.path === path);
    setSelectedFile(path);
    setEditContent(res?.content || conflict?.ours || conflict?.theirs || '');
  };

  const selectVersion = (path: string, source: 'ours' | 'theirs' | 'delete') => {
    const conflict = conflicts().find(c => c.path === path);
    if (!conflict) return;
    const newResolutions = new Map(resolutions());
    if (source === 'delete') {
      newResolutions.set(path, { path, content: '', delete: true, source: 'ours' });
    } else {
      const content = source === 'ours' ? (conflict.ours || '') : (conflict.theirs || '');
      newResolutions.set(path, { path, content, source });
    }
    setResolutions(newResolutions);
  };

  const setManualContent = (path: string, content: string) => {
    const newResolutions = new Map(resolutions());
    newResolutions.set(path, { path, content, source: 'manual' });
    setResolutions(newResolutions);
  };

  const allResolved = () => conflicts().length > 0 && conflicts().every(c => resolutions().has(c.path));

  const handleSubmit = async () => {
    if (!allResolved() || submitting()) return;
    setSubmitting(true);
    setError(null);

    try {
      // Raw fetch is used here because the `/api/repos/:repoId/pulls/:n/resolve`
      // route is not yet in the Hono rpc schema. `rpcJson` still gives us
      // 401 redirect handling and consistent error envelope parsing.
      const res = await fetch(`/api/repos/${props.repoId}/pulls/${props.prNumber}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolutions: Array.from(resolutions().values()).map(r => ({
            path: r.path,
            content: r.content,
            delete: r.delete,
          })),
        }),
      });

      await rpcJson(res);
      props.onResolved();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('failedToSubmitResolutions'));
    } finally {
      setSubmitting(false);
    }
  };

  const selectedConflict = () => conflicts().find(c => c.path === selectedFile());
  const selectedResolution = () => selectedFile() ? resolutions().get(selectedFile()!) : null;

  return (
    <>
      <Show when={loading()}>
        <div style={{ padding: '2rem', "text-align": 'center', color: 'var(--color-text-tertiary)' }}>
          {t('loadingConflictDetails')}
        </div>
      </Show>

      <Show when={!loading() && error() && conflicts().length === 0}>
        <div style={{ padding: '2rem', "text-align": 'center', color: 'var(--color-text-tertiary)' }}>
          {error()}
        </div>
      </Show>

      <Show when={!loading() && !(error() && conflicts().length === 0)}>
        <div style={{ display: 'flex', "flex-direction": 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', "align-items": 'center', "justify-content": 'space-between' }}>
            <div>
              <h3 style={{ margin: 0, "font-size": '1rem', "font-weight": 600 }}>
                {t('resolveConflictsTitle', { count: conflicts().length })}
              </h3>
              <p style={{ margin: '0.25rem 0 0', "font-size": '0.75rem', color: 'var(--color-text-tertiary)' }}>
                {props.baseBranch} ← {props.headBranch}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" onClick={props.onCancel} style={{ padding: '0.5rem 1rem', "border-radius": '6px', border: '1px solid var(--color-border)', background: 'transparent', cursor: 'pointer', "font-size": '0.875rem' }}>
                {t('cancel')}
              </button>
              <button type="button"
                onClick={handleSubmit}
                disabled={!allResolved() || submitting()}
                style={{
                  padding: '0.5rem 1rem', "border-radius": '6px', border: 'none', cursor: allResolved() ? 'pointer' : 'not-allowed',
                  background: allResolved() ? 'var(--color-primary)' : 'var(--color-bg-tertiary)',
                  color: allResolved() ? 'white' : 'var(--color-text-tertiary)',
                  "font-size": '0.875rem',
                }}
              >
                {submitting() ? t('merging') : t('commitMerge', { resolved: resolutions().size, total: conflicts().length })}
              </button>
            </div>
          </div>

          <Show when={error()}>
            <div style={{ padding: '0.5rem 1rem', background: 'var(--color-error-bg, #fef2f2)', "border-radius": '6px', color: 'var(--color-error, #dc2626)', "font-size": '0.875rem' }}>
              {error()}
            </div>
          </Show>

          <div style={{ display: 'flex', gap: '1rem', "min-height": '400px' }}>
            <div style={{ width: '240px', "flex-shrink": 0, "border-right": '1px solid var(--color-border)', "padding-right": '1rem' }}>
              <For each={conflicts()}>{(conflict) => {
                const resolved = () => resolutions().has(conflict.path);
                const isSelected = () => selectedFile() === conflict.path;
                return (
                  <div
                    onClick={() => selectFile(conflict.path)}
                    style={{
                      padding: '0.5rem', "border-radius": '4px', cursor: 'pointer', "font-size": '0.8125rem',
                      "background-color": isSelected() ? 'var(--color-bg-tertiary)' : 'transparent',
                      display: 'flex', "align-items": 'center', gap: '0.5rem',
                    }}
                  >
                    <span style={{ color: resolved() ? 'var(--color-success, #16a34a)' : 'var(--color-warning, #ca8a04)' }}>
                      {resolved() ? '✓' : '!'}
                    </span>
                    <span style={{ overflow: 'hidden', "text-overflow": 'ellipsis', "white-space": 'nowrap' }}>
                      {conflict.path.split('/').pop()}
                    </span>
                  </div>
                );
              }}</For>
            </div>

            <Show when={selectedConflict()}>
              {(conflict) => (
                <div style={{ flex: 1, display: 'flex', "flex-direction": 'column', gap: '0.75rem', "min-width": 0 }}>
                  <div style={{ "font-size": '0.8125rem', color: 'var(--color-text-secondary)', "font-family": 'monospace' }}>
                    {conflict().path}
                    <span style={{ "margin-left": '0.5rem', padding: '0.125rem 0.375rem', "border-radius": '4px', background: 'var(--color-bg-tertiary)', "font-size": '0.6875rem' }}>
                      {conflict().type}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button type="button"
                      onClick={() => selectVersion(conflict().path, 'ours')}
                      style={{
                        flex: 1, padding: '0.375rem', "border-radius": '4px', "font-size": '0.75rem', cursor: 'pointer',
                        border: selectedResolution()?.source === 'ours' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                        background: selectedResolution()?.source === 'ours' ? 'var(--color-primary-bg, #eff6ff)' : 'transparent',
                      }}
                    >
                      {t('acceptOurs', { branch: props.baseBranch })}
                    </button>
                    <button type="button"
                      onClick={() => selectVersion(conflict().path, 'theirs')}
                      style={{
                        flex: 1, padding: '0.375rem', "border-radius": '4px', "font-size": '0.75rem', cursor: 'pointer',
                        border: selectedResolution()?.source === 'theirs' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                        background: selectedResolution()?.source === 'theirs' ? 'var(--color-primary-bg, #eff6ff)' : 'transparent',
                      }}
                    >
                      {t('acceptTheirs', { branch: props.headBranch })}
                    </button>
                    <Show when={conflict().type === 'delete-modify'}>
                      <button type="button"
                        onClick={() => selectVersion(conflict().path, 'delete')}
                        style={{
                          padding: '0.375rem 0.75rem', "border-radius": '4px', "font-size": '0.75rem', cursor: 'pointer',
                          border: selectedResolution()?.delete ? '2px solid var(--color-error)' : '1px solid var(--color-border)',
                          background: selectedResolution()?.delete ? '#fef2f2' : 'transparent',
                          color: 'var(--color-error, #dc2626)',
                        }}
                      >
                        {t('deleteFile')}
                      </button>
                    </Show>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', flex: 1, "min-height": 0 }}>
                    <div style={{ flex: 1, display: 'flex', "flex-direction": 'column', "min-width": 0 }}>
                      <div style={{ "font-size": '0.6875rem', "font-weight": 600, padding: '0.25rem 0.5rem', background: 'var(--color-bg-tertiary)', "border-radius": '4px 4px 0 0' }}>
                        {props.baseBranch} {t('oursLabel')}
                      </div>
                      <pre style={{
                        flex: 1, margin: 0, padding: '0.5rem', "font-size": '0.75rem', "font-family": 'monospace',
                        overflow: 'auto', border: '1px solid var(--color-border)', "border-top": 'none',
                        "border-radius": '0 0 4px 4px', "white-space": 'pre-wrap', "word-break": 'break-all',
                        background: selectedResolution()?.source === 'ours' ? 'var(--color-primary-bg, #eff6ff)' : 'transparent',
                      }}>
                        {conflict().ours || t('fileDoesNotExist')}
                      </pre>
                    </div>

                    <div style={{ flex: 1, display: 'flex', "flex-direction": 'column', "min-width": 0 }}>
                      <div style={{ "font-size": '0.6875rem', "font-weight": 600, padding: '0.25rem 0.5rem', background: 'var(--color-bg-tertiary)', "border-radius": '4px 4px 0 0' }}>
                        {props.headBranch} {t('theirsLabel')}
                      </div>
                      <pre style={{
                        flex: 1, margin: 0, padding: '0.5rem', "font-size": '0.75rem', "font-family": 'monospace',
                        overflow: 'auto', border: '1px solid var(--color-border)', "border-top": 'none',
                        "border-radius": '0 0 4px 4px', "white-space": 'pre-wrap', "word-break": 'break-all',
                        background: selectedResolution()?.source === 'theirs' ? 'var(--color-primary-bg, #eff6ff)' : 'transparent',
                      }}>
                        {conflict().theirs || t('fileDoesNotExist')}
                      </pre>
                    </div>
                  </div>

                  <div style={{ display: 'flex', "flex-direction": 'column' }}>
                    <div style={{ "font-size": '0.6875rem', "font-weight": 600, padding: '0.25rem 0.5rem', background: 'var(--color-bg-tertiary)', "border-radius": '4px 4px 0 0', display: 'flex', "justify-content": 'space-between', "align-items": 'center' }}>
                      <span>{t('resolvedContent')}</span>
                      <button type="button"
                        onClick={() => setManualContent(conflict().path, editContent())}
                        style={{ "font-size": '0.6875rem', padding: '0.125rem 0.5rem', "border-radius": '3px', border: '1px solid var(--color-border)', background: 'transparent', cursor: 'pointer' }}
                      >
                        {t('applyEdit')}
                      </button>
                    </div>
                    <textarea
                      value={editContent()}
                      onInput={(e) => setEditContent(e.currentTarget.value)}
                      style={{
                        width: '100%', "min-height": '120px', padding: '0.5rem', "font-size": '0.75rem',
                        "font-family": 'monospace', border: '1px solid var(--color-border)', "border-top": 'none',
                        "border-radius": '0 0 4px 4px', resize: 'vertical',
                        background: selectedResolution()?.source === 'manual' ? 'var(--color-primary-bg, #eff6ff)' : 'transparent',
                      }}
                    />
                  </div>
                </div>
              )}
            </Show>
          </div>
        </div>
      </Show>
    </>
  );
}
