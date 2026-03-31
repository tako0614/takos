#!/usr/bin/env npx tsx
/**
 * Package a template for deployment
 *
 * Usage: npx tsx scripts/package-template.ts <template-slug> <source-dir>
 *
 * Example: npx tsx scripts/package-template.ts my-template ../template-source
 *
 * This script:
 * 1. Builds the worker bundle using wrangler
 * 2. Collects static assets from dist/
 * 3. Creates an assets manifest
 * 4. Uploads everything to R2
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

interface AssetManifestEntry {
  hash: string;
  size: number;
  contentType: string;
}

interface TemplateManifest {
  slug: string;
  version: string;
  bundleHash: string;
  wasmHash?: string;
  assets: Record<string, AssetManifestEntry>;
  createdAt: string;
}

const CONTENT_TYPE_MAP: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
};

const TEMPLATE_SLUG_PATTERN = /^[a-z0-9-]+$/;

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPE_MAP[ext] || 'application/octet-stream';
}

// Version salt to invalidate cached assets when format changes
// Increment this when asset upload format changes (e.g., adding Content-Type)
const ASSET_VERSION = 'v2';

function hashFile(content: Buffer): string {
  // Cloudflare expects first 32 hex characters of SHA-256 hash
  // Include version salt to invalidate cache when upload format changes
  const fullHash = crypto.createHash('sha256')
    .update(ASSET_VERSION)
    .update(content)
    .digest('hex');
  return fullHash.slice(0, 32);
}

function runCommand(command: string, args: string[], options?: { cwd?: string; stdio?: 'inherit' | 'pipe' }) {
  execFileSync(command, args, {
    cwd: options?.cwd,
    stdio: options?.stdio ?? 'inherit',
  });
}

function collectAssets(distDir: string): Map<string, { path: string; content: Buffer; contentType: string }> {
  const assets = new Map<string, { path: string; content: Buffer; contentType: string }>();

  function walk(dir: string, basePath: string = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        // Skip wrangler-build directory (worker output)
        if (entry.name === 'wrangler-build') continue;
        walk(fullPath, relativePath);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(fullPath);
        const contentType = getContentType(fullPath);
        assets.set(relativePath, { path: relativePath, content, contentType });
      }
    }
  }

  walk(distDir);
  return assets;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: npx tsx scripts/package-template.ts <template-slug> <source-dir>');
    console.error('Example: npx tsx scripts/package-template.ts my-template ../template-source');
    Deno.exit(1);
  }

  const [templateSlug, sourceDir] = args;
  const absoluteSourceDir = path.resolve(sourceDir);

  if (!TEMPLATE_SLUG_PATTERN.test(templateSlug)) {
    console.error('Invalid template slug. Use lowercase letters, numbers, and hyphens only.');
    Deno.exit(1);
  }

  if (!fs.existsSync(absoluteSourceDir)) {
    console.error(`Source directory not found: ${absoluteSourceDir}`);
    Deno.exit(1);
  }

  console.log(`📦 Packaging template: ${templateSlug}`);
  console.log(`   Source: ${absoluteSourceDir}`);

  // Step 1: Build the template
  console.log('\n🔨 Building template...');
  try {
    runCommand('npm', ['run', 'build'], { cwd: absoluteSourceDir, stdio: 'inherit' });
  } catch {
    console.error('Failed to build frontend');
    Deno.exit(1);
  }

  // Build worker with wrangler
  console.log('\n🔨 Building worker bundle...');
  try {
    runCommand(
      'npx',
      ['wrangler', 'deploy', '--dry-run', '--outdir=dist/wrangler-build'],
      { cwd: absoluteSourceDir, stdio: 'inherit' }
    );
  } catch {
    console.error('Failed to build worker');
    Deno.exit(1);
  }

  // Step 2: Find the built files
  const wranglerBuildDir = path.join(absoluteSourceDir, 'dist', 'wrangler-build');
  const distDir = path.join(absoluteSourceDir, 'dist');

  if (!fs.existsSync(wranglerBuildDir)) {
    console.error('Wrangler build output not found');
    Deno.exit(1);
  }

  // Find worker bundle and WASM
  const wranglerFiles = fs.readdirSync(wranglerBuildDir);
  const bundleFile = wranglerFiles.find(f => f === 'index.js');
  const wasmFile = wranglerFiles.find(f => f.endsWith('.wasm'));

  if (!bundleFile) {
    console.error('Worker bundle (index.js) not found');
    Deno.exit(1);
  }

  const bundleContent = fs.readFileSync(path.join(wranglerBuildDir, bundleFile));
  const bundleHash = hashFile(bundleContent);

  let wasmContent: Buffer | undefined;
  let wasmHash: string | undefined;
  if (wasmFile) {
    wasmContent = fs.readFileSync(path.join(wranglerBuildDir, wasmFile));
    wasmHash = hashFile(wasmContent);
  }

  // Step 3: Collect static assets
  console.log('\n📁 Collecting static assets...');
  const assets = collectAssets(distDir);
  console.log(`   Found ${assets.size} static assets`);

  // Step 4: Create manifest
  const manifest: TemplateManifest = {
    slug: templateSlug,
    version: '1.0.0',
    bundleHash,
    wasmHash,
    assets: {},
    createdAt: new Date().toISOString(),
  };

  for (const [relativePath, asset] of assets) {
    const hash = hashFile(asset.content);
    manifest.assets[relativePath] = {
      hash,
      size: asset.content.length,
      contentType: asset.contentType,
    };
  }

  // Step 5: Upload to R2
  console.log('\n☁️  Uploading to R2...');

  const r2Prefix = `templates/${templateSlug}`;

  // Upload bundle
  console.log('   Uploading worker bundle...');
  runCommand(
    'npx',
    ['wrangler', 'r2', 'object', 'put', `takos-worker-bundles/${r2Prefix}/bundle.js`, '--file', path.join(wranglerBuildDir, bundleFile)],
    { stdio: 'inherit' }
  );

  // Upload WASM if exists
  if (wasmContent && wasmFile) {
    console.log('   Uploading WASM...');
    runCommand(
      'npx',
      ['wrangler', 'r2', 'object', 'put', `takos-worker-bundles/${r2Prefix}/query_compiler_bg.wasm`, '--file', path.join(wranglerBuildDir, wasmFile)],
      { stdio: 'inherit' }
    );
  }

  // Upload assets
  console.log('   Uploading static assets...');
  let uploadedCount = 0;
  for (const [relativePath, asset] of assets) {
    const hash = manifest.assets[relativePath].hash;
    const tempFile = path.join(wranglerBuildDir, `temp-${hash}`);
    fs.writeFileSync(tempFile, asset.content);

    try {
      runCommand(
        'npx',
        ['wrangler', 'r2', 'object', 'put', `takos-worker-bundles/${r2Prefix}/assets/${hash}`, '--file', tempFile],
        { stdio: 'pipe' }
      );
      uploadedCount++;
      if (uploadedCount % 10 === 0) {
        console.log(`   Uploaded ${uploadedCount}/${assets.size} assets...`);
      }
    } finally {
      fs.unlinkSync(tempFile);
    }
  }
  console.log(`   Uploaded ${uploadedCount} assets`);

  // Upload manifest
  console.log('   Uploading manifest...');
  const manifestFile = path.join(wranglerBuildDir, 'manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  runCommand(
    'npx',
    ['wrangler', 'r2', 'object', 'put', `takos-worker-bundles/${r2Prefix}/manifest.json`, '--file', manifestFile],
    { stdio: 'inherit' }
  );

  console.log('\n✅ Template packaged successfully!');
  console.log(`   R2 path: takos-worker-bundles/${r2Prefix}/`);
  console.log(`   Bundle hash: ${bundleHash.slice(0, 8)}...`);
  if (wasmHash) {
    console.log(`   WASM hash: ${wasmHash.slice(0, 8)}...`);
  }
  console.log(`   Assets: ${assets.size} files`);
}

main().catch(console.error);
