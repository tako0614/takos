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
