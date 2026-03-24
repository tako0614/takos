import { useState, useEffect } from 'react';
import { useI18n } from '../../../providers/I18nProvider';

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

export function ConflictResolver({
  repoId,
  prNumber,
  baseBranch,
  headBranch,
  onResolved,
  onCancel,
}: ConflictResolverProps) {
  const [conflicts, setConflicts] = useState<ConflictFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<Map<string, Resolution>>(new Map());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    fetchConflicts();
  }, [repoId, prNumber]);

  const fetchConflicts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/repos/${repoId}/pulls/${prNumber}/conflicts`);
      const data: ConflictsResponse = await res.json();
      if (data.is_mergeable) {
        setError(t('noConflictsToResolve'));
        return;
      }
      setConflicts(data.conflicts);
      if (data.conflicts.length > 0) {
        setSelectedFile(data.conflicts[0].path);
        setEditContent(data.conflicts[0].ours || data.conflicts[0].theirs || '');
      }
    } catch (err) {
      setError(t('failedToLoadConflicts'));
    } finally {
      setLoading(false);
    }
  };

  const selectVersion = (path: string, source: 'ours' | 'theirs' | 'delete') => {
    const conflict = conflicts.find(c => c.path === path);
    if (!conflict) return;

    const newResolutions = new Map(resolutions);
    if (source === 'delete') {
      newResolutions.set(path, { path, content: '', delete: true, source: 'ours' });
    } else {
      const content = source === 'ours' ? (conflict.ours || '') : (conflict.theirs || '');
      newResolutions.set(path, { path, content, source });
    }
    setResolutions(newResolutions);
  };

  const setManualContent = (path: string, content: string) => {
    const newResolutions = new Map(resolutions);
    newResolutions.set(path, { path, content, source: 'manual' });
    setResolutions(newResolutions);
  };

  const allResolved = conflicts.length > 0 && conflicts.every(c => resolutions.has(c.path));

  const handleSubmit = async () => {
    if (!allResolved || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/repos/${repoId}/pulls/${prNumber}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolutions: Array.from(resolutions.values()).map(r => ({
            path: r.path,
            content: r.content,
            delete: r.delete,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || t('failedToSubmitResolutions'));
        return;
      }

      onResolved();
    } catch (err) {
      setError(t('failedToSubmitResolutions'));
    } finally {
      setSubmitting(false);
    }
  };

  const selectedConflict = conflicts.find(c => c.path === selectedFile);
  const selectedResolution = selectedFile ? resolutions.get(selectedFile) : null;

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
        {t('loadingConflictDetails')}
      </div>
    );
  }

  if (error && conflicts.length === 0) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
            {t('resolveConflictsTitle', { count: conflicts.length })}
          </h3>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
            {baseBranch} ← {headBranch}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={onCancel} style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'transparent', cursor: 'pointer', fontSize: '0.875rem' }}>
            {t('cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!allResolved || submitting}
            style={{
              padding: '0.5rem 1rem', borderRadius: '6px', border: 'none', cursor: allResolved ? 'pointer' : 'not-allowed',
              background: allResolved ? 'var(--color-primary)' : 'var(--color-bg-tertiary)',
              color: allResolved ? 'white' : 'var(--color-text-tertiary)',
              fontSize: '0.875rem',
            }}
          >
            {submitting ? t('merging') : t('commitMerge', { resolved: resolutions.size, total: conflicts.length })}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '0.5rem 1rem', background: 'var(--color-error-bg, #fef2f2)', borderRadius: '6px', color: 'var(--color-error, #dc2626)', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', minHeight: '400px' }}>
        <div style={{ width: '240px', flexShrink: 0, borderRight: '1px solid var(--color-border)', paddingRight: '1rem' }}>
          {conflicts.map((conflict) => {
            const resolved = resolutions.has(conflict.path);
            const isSelected = selectedFile === conflict.path;
            return (
              <div
                key={conflict.path}
                onClick={() => {
                  setSelectedFile(conflict.path);
                  const res = resolutions.get(conflict.path);
                  setEditContent(res?.content || conflict.ours || conflict.theirs || '');
                }}
                style={{
                  padding: '0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8125rem',
                  backgroundColor: isSelected ? 'var(--color-bg-tertiary)' : 'transparent',
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                }}
              >
                <span style={{ color: resolved ? 'var(--color-success, #16a34a)' : 'var(--color-warning, #ca8a04)' }}>
                  {resolved ? '✓' : '!'}
                </span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {conflict.path.split('/').pop()}
                </span>
              </div>
            );
          })}
        </div>

        {selectedConflict && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem', minWidth: 0 }}>
            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
              {selectedConflict.path}
              <span style={{ marginLeft: '0.5rem', padding: '0.125rem 0.375rem', borderRadius: '4px', background: 'var(--color-bg-tertiary)', fontSize: '0.6875rem' }}>
                {selectedConflict.type}
              </span>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => selectVersion(selectedConflict.path, 'ours')}
                style={{
                  flex: 1, padding: '0.375rem', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer',
                  border: selectedResolution?.source === 'ours' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                  background: selectedResolution?.source === 'ours' ? 'var(--color-primary-bg, #eff6ff)' : 'transparent',
                }}
              >
                {t('acceptOurs', { branch: baseBranch })}
              </button>
              <button
                onClick={() => selectVersion(selectedConflict.path, 'theirs')}
                style={{
                  flex: 1, padding: '0.375rem', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer',
                  border: selectedResolution?.source === 'theirs' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                  background: selectedResolution?.source === 'theirs' ? 'var(--color-primary-bg, #eff6ff)' : 'transparent',
                }}
              >
                {t('acceptTheirs', { branch: headBranch })}
              </button>
              {selectedConflict.type === 'delete-modify' && (
                <button
                  onClick={() => selectVersion(selectedConflict.path, 'delete')}
                  style={{
                    padding: '0.375rem 0.75rem', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer',
                    border: selectedResolution?.delete ? '2px solid var(--color-error)' : '1px solid var(--color-border)',
                    background: selectedResolution?.delete ? '#fef2f2' : 'transparent',
                    color: 'var(--color-error, #dc2626)',
                  }}
                >
                  {t('deleteFile')}
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flex: 1, minHeight: 0 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <div style={{ fontSize: '0.6875rem', fontWeight: 600, padding: '0.25rem 0.5rem', background: 'var(--color-bg-tertiary)', borderRadius: '4px 4px 0 0' }}>
                  {baseBranch} {t('oursLabel')}
                </div>
                <pre style={{
                  flex: 1, margin: 0, padding: '0.5rem', fontSize: '0.75rem', fontFamily: 'monospace',
                  overflow: 'auto', border: '1px solid var(--color-border)', borderTop: 'none',
                  borderRadius: '0 0 4px 4px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  background: selectedResolution?.source === 'ours' ? 'var(--color-primary-bg, #eff6ff)' : 'transparent',
                }}>
                  {selectedConflict.ours || t('fileDoesNotExist')}
                </pre>
              </div>

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <div style={{ fontSize: '0.6875rem', fontWeight: 600, padding: '0.25rem 0.5rem', background: 'var(--color-bg-tertiary)', borderRadius: '4px 4px 0 0' }}>
                  {headBranch} {t('theirsLabel')}
                </div>
                <pre style={{
                  flex: 1, margin: 0, padding: '0.5rem', fontSize: '0.75rem', fontFamily: 'monospace',
                  overflow: 'auto', border: '1px solid var(--color-border)', borderTop: 'none',
                  borderRadius: '0 0 4px 4px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  background: selectedResolution?.source === 'theirs' ? 'var(--color-primary-bg, #eff6ff)' : 'transparent',
                }}>
                  {selectedConflict.theirs || t('fileDoesNotExist')}
                </pre>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: '0.6875rem', fontWeight: 600, padding: '0.25rem 0.5rem', background: 'var(--color-bg-tertiary)', borderRadius: '4px 4px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{t('resolvedContent')}</span>
                <button
                  onClick={() => setManualContent(selectedConflict.path, editContent)}
                  style={{ fontSize: '0.6875rem', padding: '0.125rem 0.5rem', borderRadius: '3px', border: '1px solid var(--color-border)', background: 'transparent', cursor: 'pointer' }}
                >
                  {t('applyEdit')}
                </button>
              </div>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                style={{
                  width: '100%', minHeight: '120px', padding: '0.5rem', fontSize: '0.75rem',
                  fontFamily: 'monospace', border: '1px solid var(--color-border)', borderTop: 'none',
                  borderRadius: '0 0 4px 4px', resize: 'vertical',
                  background: selectedResolution?.source === 'manual' ? 'var(--color-primary-bg, #eff6ff)' : 'transparent',
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
