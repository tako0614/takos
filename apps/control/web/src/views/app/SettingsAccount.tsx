import { useEffect, useState } from 'react';
import { useI18n } from '../../store/i18n';
import { useToast } from '../../store/toast';
import { rpc, rpcJson } from '../../lib/rpc';
import { Icons } from '../../lib/Icons';
import { Button, Input } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { useNavigation } from '../../store/navigation';
import type { User } from '../../types';
import { normalizeUsernameInput, syncRouteWithUsernameChange } from './settings-username';

export function SettingsAccount({ user }: { user: User | null }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { fetchUser } = useAuth();
  const { route, replace } = useNavigation();

  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState(user?.username ?? '');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [savingUsername, setSavingUsername] = useState(false);

  const currentUsername = user?.username ?? '';
  const normalizedDraft = normalizeUsernameInput(usernameDraft);

  const canSaveUsername = Boolean(user)
    && normalizedDraft.length >= 3
    && normalizedDraft !== currentUsername
    && !checkingUsername
    && !savingUsername
    && usernameAvailable !== false
    && !usernameError;

  useEffect(() => {
    if (!editingUsername) {
      setUsernameDraft(currentUsername);
      setUsernameError(null);
      setUsernameAvailable(null);
      setCheckingUsername(false);
    }
  }, [currentUsername, editingUsername]);

  useEffect(() => {
    if (!editingUsername) {
      return;
    }

    if (!normalizedDraft) {
      setCheckingUsername(false);
      setUsernameAvailable(null);
      setUsernameError(null);
      return;
    }

    if (normalizedDraft.length < 3) {
      setCheckingUsername(false);
      setUsernameAvailable(null);
      setUsernameError(t('usernameTooShort'));
      return;
    }

    if (normalizedDraft === currentUsername) {
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
          json: { username: normalizedDraft },
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

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [currentUsername, editingUsername, normalizedDraft, t]);

  const handleUsernameEditCancel = () => {
    setEditingUsername(false);
  };

  const handleUsernameSave = async () => {
    if (!user || !canSaveUsername) {
      return;
    }

    setSavingUsername(true);
    try {
      const res = await rpc.me.username.$patch({
        json: { username: normalizedDraft },
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
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="space-y-3 text-sm">
        <div className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-zinc-500 dark:text-zinc-400">{t('username')}</div>
              <div className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">
                {currentUsername ? `@${currentUsername}` : '-'}
              </div>
            </div>
            {!editingUsername && (
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

          {editingUsername && (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void handleUsernameSave();
              }}
            >
              <Input
                value={usernameDraft}
                onChange={(event) => setUsernameDraft(normalizeUsernameInput(event.target.value))}
                placeholder={t('usernamePlaceholder')}
                autoFocus
                maxLength={30}
                error={usernameError || undefined}
                leftIcon={<span className="text-sm font-medium">@</span>}
                rightIcon={
                  checkingUsername
                    ? <Icons.Loader className="h-4 w-4 animate-spin" />
                    : usernameAvailable === true && normalizedDraft !== currentUsername
                      ? <Icons.Check className="h-4 w-4" />
                      : usernameAvailable === false
                        ? <Icons.X className="h-4 w-4" />
                        : null
                }
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleUsernameEditCancel}
                  disabled={savingUsername}
                >
                  {t('cancel')}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  isLoading={savingUsername}
                  disabled={!canSaveUsername}
                >
                  {t('save')}
                </Button>
              </div>
            </form>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-zinc-500 dark:text-zinc-400">{t('name')}</span>
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{user?.name || '-'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-zinc-500 dark:text-zinc-400">{t('email')}</span>
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{user?.email || '-'}</span>
        </div>
      </div>
    </div>
  );
}
