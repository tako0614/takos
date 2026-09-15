/**
 * Post-prerender fixups for the static landing output.
 *
 * SolidStart's document shell (`entry-server.tsx`) is shared across routes, so
 * every prerendered page ships `<html lang="ja">`. `theme-init.js` patches the
 * EN route's lang client-side, but crawlers / screen readers that read the raw
 * HTML before JS should see the correct language. Here we bake `lang="en"` into
 * the prerendered EN document so the static HTML is correct on its own.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// SolidStart emits inline hydration code and a route manifest. Authorize only
// the exact prerendered code; script-src stays closed to arbitrary inline JS.
async function authorizePrerenderedScripts() {
  const output = fileURLToPath(new URL('../.output/public/', import.meta.url));
  const hashes = new Set();
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        const html = await readFile(path, 'utf8');
        for (const [, attributes, code] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
          if (/\bsrc\s*=/i.test(attributes) || !code.trim()) continue;
          if (/\btype\s*=\s*["']application\/ld\+json["']/i.test(attributes)) continue;
          hashes.add(`'sha256-${createHash('sha256').update(code).digest('base64')}'`);
        }
      }
    }
  }
  await visit(output);
  const source = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
  if (!/\bscript-src [^;]+;/.test(source)) throw new Error('Missing script-src in the site CSP');
  const headers = source.replace(/\bscript-src ([^;]+);/, (_, allowed) =>
    `script-src ${allowed} ${[...hashes].sort().join(' ')};`);
  await writeFile(join(output, '_headers'), headers);
  console.log(`[postbuild] authorized ${hashes.size} exact inline script hashes in the site CSP`);
}

await authorizePrerenderedScripts();
