import { useState, useEffect, useRef, type CSSProperties, type FormEvent, type ChangeEvent } from 'react';
import { useI18n } from '../../../providers/I18nProvider';
import { Modal, ModalFooter } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import type { Repository, Workspace } from '../../../types';
import { rpc, rpcJson } from '../../../lib/rpc';
import { useToast } from '../../../hooks/useToast';
import { Icons } from '../../../lib/Icons';
import { useAuth } from '../../../contexts/AuthContext';

interface ForkApiResponse {
  repository: Repository;
  forked_from: {
    id: string;
    name: string;
    space_id: string;
    is_official: boolean;
    owner_username?: string | null;
    owner_name?: string | null;
  };
  workflows_copied: number;
}

export interface ForkModalProps {
  repo: Repository;
  onClose: () => void;
  onSuccess: (forkedRepo: Repository) => void;
}

export function ForkModal({
  repo,
  onClose,
  onSuccess,
}: ForkModalProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { workspaces, workspacesLoaded } = useAuth();
  const [targetWorkspaceId, setTargetWorkspaceId] = useState<string>('');
  const [customName, setCustomName] = useState('');
  const [copyWorkflows, setCopyWorkflows] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };

    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [dropdownOpen]);

  // Set default target workspace when workspaces are loaded
  useEffect(() => {
    if (!workspacesLoaded || workspaces.length === 0 || targetWorkspaceId) return;
    const personal = workspaces.find((w) => w.kind === 'user');
    if (personal) {
      setTargetWorkspaceId(personal.kind === 'user' ? 'me' : personal.slug);
    } else {
      setTargetWorkspaceId(workspaces[0].slug);
    }
  }, [workspaces, workspacesLoaded, targetWorkspaceId]);

  const selectedWorkspace = workspaces.find(w =>
    targetWorkspaceId === 'me' ? w.kind === 'user' : w.slug === targetWorkspaceId
  );

  const effectiveName = customName.trim() || repo.name;
  const isSelfFork = targetWorkspaceId === repo.space_id && effectiveName === repo.name;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await rpc.repos[':repoId'].fork.$post({
        param: { repoId: repo.id },
        json: {
          target_space_id: targetWorkspaceId,
          name: customName.trim() || undefined,
          copy_workflows: copyWorkflows,
        },
      });

      const data = await rpcJson<ForkApiResponse>(res);

      if (data.repository) {
        showToast('success', t('forkedSuccess', { name: data.repository.name }));
        onSuccess(data.repository);
      } else {
        showToast('success', t('forkedSuccess', { name: customName || repo.name }));
        onClose();
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('unknownError');
      setError(`${t('forkFailed')}: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const labelStyle: CSSProperties = {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: 'var(--color-text-secondary)',
    marginBottom: '0.5rem',
  };

  const fieldGroupStyle: CSSProperties = {
    marginBottom: '1rem',
  };

  const errorStyle: CSSProperties = {
    fontSize: '0.875rem',
    color: 'var(--color-error)',
    marginTop: '0.5rem',
  };

  const hintStyle: CSSProperties = {
    fontSize: '0.75rem',
    color: 'var(--color-text-tertiary)',
    marginTop: '0.25rem',
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      size="sm"
      title={t('forkRepository')}
    >
      {!workspacesLoaded ? (
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-[var(--color-border-primary)] border-t-[var(--color-primary)] rounded-full animate-spin" />
        </div>
      ) : workspaces.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <Icons.Folder className="w-8 h-8 text-[var(--color-text-tertiary)]" />
          <p className="text-sm text-[var(--color-text-secondary)]">{t('noWorkspacesAvailable')}</p>
        </div>
      ) : (
      <form onSubmit={handleSubmit}>
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>{t('targetWorkspace')}</label>
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              className="w-full flex items-center justify-between px-3 py-2.5 min-h-[44px] text-base bg-[var(--color-surface-primary)] text-[var(--color-text-primary)] border border-[var(--color-border-primary)] rounded-[var(--radius-md)] cursor-pointer transition-colors hover:border-[var(--color-border-focus)]"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              disabled={!workspacesLoaded}
            >
              <span className="flex items-center gap-2">
                {selectedWorkspace ? (
                  <>
                    {selectedWorkspace.is_personal ? (
                      <Icons.User className="w-4 h-4" />
                    ) : (
                      <Icons.Users className="w-4 h-4" />
                    )}
                    <span>{selectedWorkspace.name}</span>
                    {selectedWorkspace.is_personal && (
                      <span className="text-xs text-[var(--color-text-tertiary)]">({t('personal')})</span>
                    )}
                  </>
                ) : (
                  <span>{t('selectWorkspace')}</span>
                )}
              </span>
              <Icons.ChevronDown className="w-4 h-4 text-[var(--color-text-tertiary)]" />
            </button>

            {dropdownOpen && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-[var(--color-surface-primary)] border border-[var(--color-border-primary)] rounded-[var(--radius-md)] shadow-lg z-20 max-h-60 overflow-y-auto">
                {workspaces.map(workspace => {
                  const wsIdentifier = workspace.is_personal ? 'me' : workspace.slug;
                  const isSelected = targetWorkspaceId === wsIdentifier;
                  return (
                    <button
                      key={workspace.slug}
                      type="button"
                      className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors ${
                        isSelected
                          ? 'bg-[var(--color-primary-bg)] text-[var(--color-primary)]'
                          : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-secondary)]'
                      }`}
                      onClick={() => {
                        setTargetWorkspaceId(wsIdentifier);
                        setDropdownOpen(false);
                        setError(null);
                      }}
                    >
                      {workspace.is_personal ? (
                        <Icons.User className="w-4 h-4" />
                      ) : (
                        <Icons.Users className="w-4 h-4" />
                      )}
                      <span>{workspace.name}</span>
                      {workspace.is_personal && (
                        <span className="text-xs text-[var(--color-text-tertiary)]">({t('personal')})</span>
                      )}
                      {isSelected && (
                        <Icons.Check className="w-4 h-4 ml-auto" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div style={fieldGroupStyle}>
          <label htmlFor="fork-name" style={labelStyle}>
            {t('repositoryName')} <span className="text-[var(--color-text-tertiary)]">({t('optional')})</span>
          </label>
          <Input
            id="fork-name"
            type="text"
            placeholder={repo.name}
            value={customName}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setCustomName(e.target.value);
              setError(null);
            }}
          />
          <p style={hintStyle}>{t('forkNameHint')}</p>
        </div>

        <div style={fieldGroupStyle}>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={copyWorkflows}
              onChange={(e) => setCopyWorkflows(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-[var(--color-border-primary)] text-[var(--color-primary)] focus:ring-[var(--color-primary)] cursor-pointer"
            />
            <div>
              <span className="text-sm font-medium text-[var(--color-text-primary)]">
                {t('copyWorkflows')}
              </span>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                {t('copyWorkflowsHint')}
              </p>
            </div>
          </label>
        </div>

        {error && <div style={errorStyle} role="alert">{error}</div>}

        {isSelfFork && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-700 mb-4">
            <Icons.AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <span className="text-sm text-amber-700 dark:text-amber-300">
              {t('cannotForkToSelf')}
            </span>
          </div>
        )}

        <ModalFooter style={{ margin: '0 -1.5rem -1.5rem', padding: '1rem 1.5rem' }}>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={loading}
          >
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            isLoading={loading}
            disabled={loading || !targetWorkspaceId || isSelfFork}
          >
            {loading ? t('forking') : t('fork')}
          </Button>
        </ModalFooter>
      </form>
      )}
    </Modal>
  );
}
