import { createEffect, onMount, onCleanup, createSignal } from 'solid-js';
import { useI18n } from '../../store/i18n.ts';
import { useToast } from '../../store/toast.ts';
import { rpc, rpcJson } from '../../lib/rpc.ts';
import { Icons } from '../../lib/Icons.tsx';
import { Button, Input } from '../../components/ui/index.ts';
import { useAuth } from '../../hooks/useAuth.ts';
import { useNavigation } from '../../store/navigation.ts';
import type { User } from '../../types/index.ts';
import { normalizeUsernameInput, syncRouteWithUsernameChange } from './settings-username.ts';

export function SettingsAccount({ user }: { user: User | null }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { fetchUser } = useAuth();
  const { route, replace } = useNavigation();

  const [editingUsername, setEditingUsername] = createSignal(false);
  const [usernameDraft, setUsernameDraft] = createSignal(user?.username ?? '');
  const [usernameError, setUsernameError] = createSignal<string | null>(null);
  const [usernameAvailable, setUsernameAvailable] = createSignal<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = createSignal(false);
  const [savingUsername, setSavingUsername] = createSignal(false);

  const currentUsername = user?.username ?? '';
  const normalizedDraft = () => normalizeUsernameInput(usernameDraft());

  const canSaveUsername = () => Boolean(user)
    && normalizedDraft().length >= 3
    && normalizedDraft() !== currentUsername
    && !checkingUsername()
    && !savingUsername()
    && usernameAvailable() !== false
    && !usernameError();

  createEffect(() => {
    if (!editingUsername()) {
      setUsernameDraft(currentUsername);
      setUsernameError(null);
      setUsernameAvailable(null);
      setCheckingUsername(false);
    }
  });

  createEffect(() => {
    if (!editingUsername()) {
      return;
    }

    if (!normalizedDraft()) {
      setCheckingUsername(false);
      setUsernameAvailable(null);
      setUsernameError(null);
      return;
    }

    if (normalizedDraft().length < 3) {
      setCheckingUsername(false);
      setUsernameAvailable(null);
      setUsernameError(t('usernameTooShort'));
      return;
    }

    if (normalizedDraft() === currentUsername) {
      setCheckingUsername(false);
      setUsernameAvailable(true);
      setUsernameError(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setCheckingUsername(true);
      try {
        const res = await rpc.setup['check-username'].$post({
          json: { username: normalizedDraft() },
        });
        const data = await rpcJson<{ available: boolean; error?: string }>(res);
        if (cancelled) {
          return;
        }
        setUsernameAvailable(data.available);
        setUsernameError(data.error || null);
      } catch {
        if (!cancelled) {
          setUsernameAvailable(null);
          setUsernameError(t('failedToCheckUsername'));
        }
      } finally {
        if (!cancelled) {
          setCheckingUsername(false);
        }
      }
    }, 300);

    onCleanup(() => {
      cancelled = true;
      window.clearTimeout(timer);
    });
  });

  const handleUsernameEditCancel = () => {
    setEditingUsername(false);
  };

  const handleUsernameSave = async () => {
    if (!user || !canSaveUsername()) {
      return;
    }

    setSavingUsername(true);
    try {
      const res = await rpc.me.username.$patch({
        json: { username: normalizedDraft() },
      });
      const data = await rpcJson<{ success: boolean; username: string }>(res);
      const nextRoute = syncRouteWithUsernameChange(route, currentUsername, data.username);

      if (nextRoute !== route) {
        replace(nextRoute);
      }

      await fetchUser();
      setEditingUsername(false);
      setUsernameDraft(data.username);
      setUsernameAvailable(true);
      setUsernameError(null);
      showToast('success', t('saved'));
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failedToSave');
      setUsernameError(message);
      setUsernameAvailable(false);
      showToast('error', message);
    } finally {
      setSavingUsername(false);
    }
  };

  return (
    <div class="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div class="space-y-3 text-sm">
        <div class="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-zinc-500 dark:text-zinc-400">{t('username')}</div>
              <div class="mt-1 font-medium text-zinc-900 dark:text-zinc-100">
                {currentUsername ? `@${currentUsername}` : '-'}
              </div>
            </div>
            {!editingUsername() && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEditingUsername(true)}
                disabled={!user}
              >
                {t('edit')}
              </Button>
            )}
          </div>

          {editingUsername() && (
            <form
              class="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void handleUsernameSave();
              }}
            >
              <Input
                value={usernameDraft()}
                onChange={(event) => setUsernameDraft(normalizeUsernameInput(event.target.value))}
                placeholder={t('usernamePlaceholder')}
                autofocus
                maxLength={30}
                error={usernameError() || undefined}
                leftIcon={<span class="text-sm font-medium">@</span>}
                rightIcon={
                  checkingUsername()
                    ? <Icons.Loader class="h-4 w-4 animate-spin" />
                    : usernameAvailable() === true && normalizedDraft() !== currentUsername
                      ? <Icons.Check class="h-4 w-4" />
                      : usernameAvailable() === false
                        ? <Icons.X class="h-4 w-4" />
                        : null
                }
              />
              <div class="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleUsernameEditCancel}
                  disabled={savingUsername()}
                >
                  {t('cancel')}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  isLoading={savingUsername()}
                  disabled={!canSaveUsername()}
                >
                  {t('save')}
                </Button>
              </div>
            </form>
          )}
        </div>
        <div class="flex items-center justify-between">
          <span class="text-zinc-500 dark:text-zinc-400">{t('name')}</span>
          <span class="font-medium text-zinc-900 dark:text-zinc-100">{user?.name || '-'}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-zinc-500 dark:text-zinc-400">{t('email')}</span>
          <span class="font-medium text-zinc-900 dark:text-zinc-100">{user?.email || '-'}</span>
        </div>
      </div>
    </div>
  );
}
