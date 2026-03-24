import { useI18n } from '../../providers/I18nProvider';

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const { t, lang, setLang } = useI18n();

  return (
    <div className="flex items-center justify-center min-h-screen bg-white dark:bg-zinc-900 p-4">
      <div className="w-full max-w-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8 text-center">
        <div className="flex justify-center mb-6">
          <img src="/logo.png" alt="Takos" className="w-16 h-16 rounded-xl" />
        </div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">{t('appName')}</h1>
        <p className="text-zinc-500 dark:text-zinc-400 mb-8">{t('loginSubtitle')}</p>

        <button className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 rounded-lg font-medium hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors" onClick={onLogin}>
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          {t('continueWithGoogle')}
        </button>

        <div className="flex justify-center gap-2 mt-6">
          <button
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${lang === 'ja' ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'}`}
            onClick={() => setLang('ja')}
          >
            日本語
          </button>
          <button
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${lang === 'en' ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'}`}
            onClick={() => setLang('en')}
          >
            English
          </button>
        </div>

        <div className="flex justify-center gap-3 mt-4 text-xs text-zinc-400">
          <a href="https://developers.takos.jp" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-600 dark:hover:text-zinc-300">{t('docs')}</a>
          <a href="/terms" className="hover:text-zinc-600 dark:hover:text-zinc-300">{t('terms')}</a>
          <a href="/privacy" className="hover:text-zinc-600 dark:hover:text-zinc-300">{t('privacy')}</a>
        </div>
      </div>
    </div>
  );
}

