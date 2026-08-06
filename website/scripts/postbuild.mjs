/**
 * Post-prerender fixups for the static landing output.
 *
 * SolidStart's document shell (`entry-server.tsx`) is shared across routes, so
 * every prerendered page ships `<html lang="ja">`. `theme-init.js` patches the
 * EN route's lang client-side, but crawlers / screen readers that read the raw
 * HTML before JS should see the correct language. Here we bake `lang="en"` into
 * the prerendered EN document so the static HTML is correct on its own.
 */
import { readFile, writeFile } from 'node:fs/promises';

const EN_HTML = new URL('../.output/public/en/index.html', import.meta.url);

async function fixEnLang() {
  let html;
  try {
    html = await readFile(EN_HTML, 'utf8');
  } catch {
    console.warn('[postbuild] en/index.html not found — skipping lang fixup');
    return;
  }
  const fixed = html.replace('<html lang="ja"', '<html lang="en"');
  if (fixed === html) {
    console.warn('[postbuild] no <html lang="ja"> found in en/index.html — skipping');
    return;
  }
  await writeFile(EN_HTML, fixed);
  console.log('[postbuild] set <html lang="en"> on the prerendered /en/ route');
}

await fixEnLang();

// Docs をランディングの Pages 出力に統合する。docs.takos.jp は廃止し、
// takosumi と同じ /docs 構成で takos.jp/docs に配信する。
// VitePress を VITEPRESS_BASE=/docs/ で build し、.output/public/docs/ へ置く。
// 1 つの Pages プロジェクト (takos-landing) が / と /docs/ の両方を serve する。
import { mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const DOCS_SOURCE = new URL('../../docs/.vitepress/dist/', import.meta.url);
const DOCS_TARGET = new URL('../.output/public/docs/', import.meta.url);

async function bundleDocs() {
  try {
    execFileSync('bunx', ['vitepress', 'build', 'docs'], {
      cwd: new URL('../..', import.meta.url),
      env: { ...process.env, VITEPRESS_BASE: '/docs/' },
      stdio: 'inherit',
    });
  } catch (error) {
    console.error('[postbuild] docs build failed:', error.message);
    process.exit(1);
  }
  await rm(DOCS_TARGET, { recursive: true, force: true });
  await mkdir(DOCS_TARGET, { recursive: true });
  const { cp } = await import('node:fs/promises');
  await cp(DOCS_SOURCE, DOCS_TARGET, { recursive: true });
  console.log('[postbuild] bundled docs into .output/public/docs/');
}

await bundleDocs();
