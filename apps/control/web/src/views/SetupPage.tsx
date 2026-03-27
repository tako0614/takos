import { useState, useEffect } from 'react';
import { Icons } from '../lib/Icons';
import { useI18n } from '../store/i18n';
import { rpc, rpcJson } from '../lib/rpc';

interface SetupPageProps {
  onComplete: () => void;
}

export function SetupPage({ onComplete }: SetupPageProps) {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!username || username.length < 3) {
      setUsernameAvailable(null);
      setUsernameError(null);
      return;
    }

    const timer = setTimeout(async () => {
      setCheckingUsername(true);
      try {
        const res = await rpc.setup['check-username'].$post({
          json: { username },
        });
        const data = await rpcJson<{ available: boolean; error?: string }>(res);
        setUsernameAvailable(data.available);
        setUsernameError(data.error || null);
      } catch {
        setUsernameError(t('failedToCheckUsername'));
      } finally {
        setCheckingUsername(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [username, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username || username.length < 3) {
      setError(t('usernameTooShort'));
      return;
    }

    if (password && password !== confirmPassword) {
      setError(t('passwordMismatch'));
      return;
    }

    if (password && password.length < 8) {
      setError(t('passwordTooShort'));
      return;
    }

    setSubmitting(true);
    try {
      const res = await rpc.setup.complete.$post({
        json: {
          username,
          password: password || undefined,
        },
      });
      await rpcJson(res);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="p-6">
          <div className="text-center mb-6">
            <h1 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">{t('setupWelcome')}</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{t('setupAccountSubtitle')}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div>
              <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">
                {t('username')}
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                  placeholder={t('usernamePlaceholder')}
                  className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
                  maxLength={30}
                  required
                />
                {checkingUsername && (
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                    <div className="w-3.5 h-3.5 border border-zinc-400 dark:border-zinc-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                {!checkingUsername && usernameAvailable === true && (
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 dark:text-zinc-400">
                    <Icons.Check className="w-3.5 h-3.5" />
                  </div>
                )}
                {!checkingUsername && usernameAvailable === false && (
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500">
                    <Icons.X className="w-3.5 h-3.5" />
                  </div>
                )}
              </div>
              {usernameError && (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{usernameError}</p>
              )}
            </div>

            {/* Password (optional) */}
            <div>
              <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">
                {t('password')} <span className="text-zinc-400 dark:text-zinc-500">{t('passwordOptional')}</span>
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('passwordPlaceholder')}
                className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
              />
            </div>

            {/* Confirm Password */}
            {password && (
              <div>
                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">
                  {t('confirmPasswordLabel')}
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t('confirmPasswordPlaceholder')}
                  className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
                />
              </div>
            )}

            {/* Error */}
            {error && (
              <p className="text-xs text-zinc-600 dark:text-zinc-400">{error}</p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting || !username || usernameAvailable === false || checkingUsername}
              className="w-full py-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white dark:text-zinc-900 text-sm rounded transition-colors"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-1.5">
                  <span className="w-3 h-3 border border-white dark:border-zinc-900 border-t-transparent rounded-full animate-spin" />
                  {t('settingUp')}
                </span>
              ) : (
                t('continue')
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
