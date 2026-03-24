import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { type Lang, type Page, PAGES, slugFromPath } from './types';
import OverviewSection from './sections/OverviewSection';
import QuickstartSection from './sections/QuickstartSection';
import GitHostingSection from './sections/GitHostingSection';
import AppDeploySection from './sections/AppDeploySection';
import AiAgentSection from './sections/AiAgentSection';
import CliSection from './sections/CliSection';
import ApiSection from './sections/ApiSection';
import McpSection from './sections/McpSection';

const SECTION_COMPONENTS: Record<Page, (props: { lang: Lang }) => ReactNode> = {
  'overview': OverviewSection,
  'quickstart': QuickstartSection,
  'git-hosting': GitHostingSection,
  'app-deploy': AppDeploySection,
  'ai-agent': AiAgentSection,
  'cli': CliSection,
  'api': ApiSection,
  'mcp': McpSection,
};

export default function App() {
  const [lang, setLang] = useState<Lang>(() => {
    if (typeof navigator !== 'undefined' && navigator.language.startsWith('ja')) return 'ja';
    return 'en';
  });
  const [page, setPage] = useState<Page>(() => {
    return slugFromPath(window.location.pathname) ?? 'overview';
  });

  const navigate = useCallback((p: Page) => {
    setPage(p);
    window.history.pushState(null, '', p === 'overview' ? '/' : `/${p}`);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const onPop = () => {
      setPage(slugFromPath(window.location.pathname) ?? 'overview');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const Section = SECTION_COMPONENTS[page];
  const currentTitle = PAGES.find((p) => p.slug === page)?.title[lang] ?? '';

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <button className="flex items-center gap-2" onClick={() => navigate('overview')} type="button">
            <span className="text-lg font-bold text-zinc-100">Takos</span>
            <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400">Docs</span>
          </button>
          <div className="flex items-center gap-1">
            <button
              className={`rounded-full px-3 py-1.5 text-sm transition-colors ${lang === 'ja' ? 'bg-zinc-100 text-zinc-900 font-medium' : 'text-zinc-500 hover:text-zinc-300'}`}
              onClick={() => setLang('ja')}
              type="button"
            >
              日本語
            </button>
            <button
              className={`rounded-full px-3 py-1.5 text-sm transition-colors ${lang === 'en' ? 'bg-zinc-100 text-zinc-900 font-medium' : 'text-zinc-500 hover:text-zinc-300'}`}
              onClick={() => setLang('en')}
              type="button"
            >
              English
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:py-10">
        {/* Sidebar */}
        <aside className="hidden lg:block lg:sticky lg:top-16 lg:h-fit lg:w-48 lg:shrink-0">
          <nav className="space-y-1">
            {PAGES.map((pg) => (
              <button
                key={pg.slug}
                className={`block w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
                  pg.slug === page
                    ? 'bg-zinc-800 text-zinc-100 font-medium'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
                onClick={() => navigate(pg.slug)}
                type="button"
              >
                {pg.title[lang]}
              </button>
            ))}
          </nav>
        </aside>

        {/* Mobile nav */}
        <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-md px-2 py-2 lg:hidden">
          <div className="flex gap-1 overflow-x-auto">
            {PAGES.map((pg) => (
              <button
                key={pg.slug}
                className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                  pg.slug === page
                    ? 'bg-zinc-800 text-zinc-100 font-medium'
                    : 'text-zinc-500'
                }`}
                onClick={() => navigate(pg.slug)}
                type="button"
              >
                {pg.title[lang]}
              </button>
            ))}
          </div>
        </div>

        {/* Main */}
        <main className="min-w-0 flex-1 pb-16 lg:pb-0">
          <h1 className="mb-6 text-2xl font-bold text-zinc-100">{currentTitle}</h1>
          <div className="prose-zinc">
            <Section lang={lang} />
          </div>
        </main>
      </div>
    </div>
  );
}
