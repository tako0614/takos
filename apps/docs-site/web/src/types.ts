export type Lang = 'ja' | 'en';
export type Page = 'overview' | 'quickstart' | 'git-hosting' | 'app-deploy' | 'ai-agent' | 'cli' | 'api' | 'mcp';

export const PAGES: { slug: Page; title: Record<Lang, string> }[] = [
  { slug: 'overview', title: { ja: 'Overview', en: 'Overview' } },
  { slug: 'quickstart', title: { ja: 'Get Started', en: 'Get Started' } },
  { slug: 'git-hosting', title: { ja: 'Git Hosting', en: 'Git Hosting' } },
  { slug: 'app-deploy', title: { ja: 'Deploy', en: 'Deploy' } },
  { slug: 'ai-agent', title: { ja: 'AI Agent', en: 'AI Agent' } },
  { slug: 'cli', title: { ja: 'CLI', en: 'CLI' } },
  { slug: 'api', title: { ja: 'API', en: 'API' } },
  { slug: 'mcp', title: { ja: 'MCP', en: 'MCP' } },
];

export function slugFromPath(path: string): Page | null {
  const p = path.replace(/^\//, '');
  if (p === '' || p === 'overview') return 'overview';
  const found = PAGES.find((pg) => pg.slug === p);
  return found ? found.slug : null;
}
