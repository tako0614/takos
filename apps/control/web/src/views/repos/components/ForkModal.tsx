import { createSignal, createEffect, on, onCleanup, Show, For } from 'solid-js';
import type { JSX } from 'solid-js';
import { useI18n } from '../../../store/i18n.ts';
import { Modal, ModalFooter } from '../../../components/ui/Modal.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { Input } from '../../../components/ui/Input.tsx';
import type { Repository } from '../../../types/index.ts';
import { rpc, rpcJson } from '../../../lib/rpc.ts';
import { useToast } from '../../../store/toast.ts';
import { Icons } from '../../../lib/Icons.tsx';
import { useAuth } from '../../../hooks/useAuth.ts';

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

export function ForkModal(props: ForkModalProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { spaces, spacesLoaded } = useAuth();
  const [targetSpaceId, setTargetSpaceId] = createSignal<string>('');
  const [customName, setCustomName] = createSignal('');
  const [copyWorkflows, setCopyWorkflows] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = createSignal(false);
  let dropdownRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (!dropdownOpen()) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef && !dropdownRef.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    onCleanup(() => {
      document.removeEventListener('mousedown', handleClickOutside);
    });
  });

  // Set default target space when spaces are loaded
  createEffect(on(
    () => [spaces, spacesLoaded, targetSpaceId()],
    () => {
      if (!spacesLoaded || spaces.length === 0 || targetSpaceId()) return;
      const personal = spaces.find((w) => w.kind === 'user');
      if (personal) {
        setTargetSpaceId(personal.kind === 'user' ? 'me' : (personal.slug ?? ''));
      } else {
        setTargetSpaceId(spaces[0].slug ?? '');
      }
    },
  ));

  const selectedSpace = () => spaces.find(w =>
    targetSpaceId() === 'me' ? w.kind === 'user' : w.slug === targetSpaceId()
  );

  const effectiveName = () => customName().trim() || props.repo.name;
  const isSelfFork = () => targetSpaceId() === props.repo.space_id && effectiveName() === props.repo.name;

  const handleSubmit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await rpc.repos[':repoId'].fork.$post({
        param: { repoId: props.repo.id },
        json: {
          target_space_id: targetSpaceId(),
          name: customName().trim() || undefined,
          copy_workflows: copyWorkflows(),
        },
      });

      const data = await rpcJson<ForkApiResponse>(res);

      if (data.repository) {
        showToast('success', t('forkedSuccess', { name: data.repository.name }));
        props.onSuccess(data.repository);
      } else {
        showToast('success', t('forkedSuccess', { name: customName() || props.repo.name }));
        props.onClose();
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('unknownError');
      setError(`${t('forkFailed')}: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const labelStyle: JSX.CSSProperties = {
    display: 'block',
    "font-size": '0.875rem',
    "font-weight": 500,
    color: 'var(--color-text-secondary)',
    "margin-bottom": '0.5rem',
  };

  const fieldGroupStyle: JSX.CSSProperties = {
    "margin-bottom": '1rem',
  };

  const errorStyle: JSX.CSSProperties = {
    "font-size": '0.875rem',
    color: 'var(--color-error)',
    "margin-top": '0.5rem',
  };

  const hintStyle: JSX.CSSProperties = {
    "font-size": '0.75rem',
    color: 'var(--color-text-tertiary)',
    "margin-top": '0.25rem',
  };

  return (
    <Modal
      isOpen
      onClose={props.onClose}
      size="sm"
      title={t('forkRepository')}
    >
      <Show when={!spacesLoaded}>
        <div class="flex items-center justify-center py-8">
          <div class="w-6 h-6 border-2 border-[var(--color-border-primary)] border-t-[var(--color-primary)] rounded-full animate-spin" />
        </div>
      </Show>

      <Show when={spacesLoaded && spaces.length === 0}>
        <div class="flex flex-col items-center justify-center py-8 gap-2">
          <Icons.Folder class="w-8 h-8 text-[var(--color-text-tertiary)]" />
          <p class="text-sm text-[var(--color-text-secondary)]">{t('noSpacesAvailable')}</p>
        </div>
      </Show>

      <Show when={spacesLoaded && spaces.length > 0}>
        <form onSubmit={handleSubmit}>
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>{t('targetSpace')}</label>
            <div class="relative" ref={dropdownRef}>
              <button
                type="button"
                class="w-full flex items-center justify-between px-3 py-2.5 min-h-[44px] text-base bg-[var(--color-surface-primary)] text-[var(--color-text-primary)] border border-[var(--color-border-primary)] rounded-[var(--radius-md)] cursor-pointer transition-colors hover:border-[var(--color-border-focus)]"
                onClick={() => setDropdownOpen(!dropdownOpen())}
                disabled={!spacesLoaded}
              >
                <span class="flex items-center gap-2">
                  <Show when={selectedSpace()} fallback={<span>{t('selectSpace')}</span>}>
                    {(space) => (
                      <>
                        {space().is_personal ? (
                          <Icons.User class="w-4 h-4" />
                        ) : (
                          <Icons.Users class="w-4 h-4" />
                        )}
                        <span>{space().name}</span>
                        <Show when={space().is_personal}>
                          <span class="text-xs text-[var(--color-text-tertiary)]">({t('personal')})</span>
                        </Show>
                      </>
                    )}
                  </Show>
                </span>
                <Icons.ChevronDown class="w-4 h-4 text-[var(--color-text-tertiary)]" />
              </button>

              <Show when={dropdownOpen()}>
                <div class="absolute left-0 right-0 top-full mt-1 bg-[var(--color-surface-primary)] border border-[var(--color-border-primary)] rounded-[var(--radius-md)] shadow-lg z-20 max-h-60 overflow-y-auto">
                  <For each={spaces}>{(space) => {
                    const wsIdentifier = space.is_personal ? 'me' : (space.slug ?? '');
                    const isSelected = () => targetSpaceId() === wsIdentifier;
                    return (
                      <button
                        type="button"
                        class={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors ${
                          isSelected()
                            ? 'bg-[var(--color-primary-bg)] text-[var(--color-primary)]'
                            : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-secondary)]'
                        }`}
                        onClick={() => {
                          setTargetSpaceId(wsIdentifier);
                          setDropdownOpen(false);
                          setError(null);
                        }}
                      >
                        {space.is_personal ? (
                          <Icons.User class="w-4 h-4" />
                        ) : (
                          <Icons.Users class="w-4 h-4" />
                        )}
                        <span>{space.name}</span>
                        <Show when={space.is_personal}>
                          <span class="text-xs text-[var(--color-text-tertiary)]">({t('personal')})</span>
                        </Show>
                        <Show when={isSelected()}>
                          <Icons.Check class="w-4 h-4 ml-auto" />
                        </Show>
                      </button>
                    );
                  }}</For>
                </div>
              </Show>
            </div>
          </div>

          <div style={fieldGroupStyle}>
            <label for="fork-name" style={labelStyle}>
              {t('repositoryName')} <span class="text-[var(--color-text-tertiary)]">({t('optional')})</span>
            </label>
            <Input
              id="fork-name"
              type="text"
              placeholder={props.repo.name}
              value={customName()}
              onInput={(e: Event & { currentTarget: HTMLInputElement }) => {
                setCustomName(e.currentTarget.value);
                setError(null);
              }}
            />
            <p style={hintStyle}>{t('forkNameHint')}</p>
          </div>

          <div style={fieldGroupStyle}>
            <label class="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={copyWorkflows()}
                onInput={(e) => setCopyWorkflows(e.currentTarget.checked)}
                class="mt-0.5 w-4 h-4 rounded border-[var(--color-border-primary)] text-[var(--color-primary)] focus:ring-[var(--color-primary)] cursor-pointer"
              />
              <div>
                <span class="text-sm font-medium text-[var(--color-text-primary)]">
                  {t('copyWorkflows')}
                </span>
                <p class="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                  {t('copyWorkflowsHint')}
                </p>
              </div>
            </label>
          </div>

          <Show when={error()}>
            <div style={errorStyle} role="alert">{error()}</div>
          </Show>

          <Show when={isSelfFork()}>
            <div class="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-700 mb-4">
              <Icons.AlertTriangle class="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <span class="text-sm text-amber-700 dark:text-amber-300">
                {t('cannotForkToSelf')}
              </span>
            </div>
          </Show>

          <ModalFooter style={{ margin: '0 -1.5rem -1.5rem', padding: '1rem 1.5rem' }}>
            <Button
              type="button"
              variant="secondary"
              onClick={props.onClose}
              disabled={loading()}
            >
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              isLoading={loading()}
              disabled={loading() || !targetSpaceId() || isSelfFork()}
            >
              {loading() ? t('forking') : t('fork')}
            </Button>
          </ModalFooter>
        </form>
      </Show>
    </Modal>
  );
}
