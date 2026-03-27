/**
 * Entry point for takopack manifest handling.
 *
 * Re-exports from sub-modules so that existing `import { ... } from './manifest'`
 * statements continue to work without modification.
 */

import type { ParsedTakopackPackage, TakopackManifest } from './types';
import { normalizePackagePath, getPackageFile, decodeArrayBuffer } from './manifest-utils';
import { parseManifestObjects } from './manifest-parsing';
import { parseChecksums } from './manifest-parsing';
import { buildNormalizedManifest } from './manifest-builder';

// Re-export everything that was previously exported from this file.
export {
  normalizePackagePath,
  normalizePackageDirectory,
  getPackageFile,
  getRequiredPackageFile,
  decodeArrayBuffer,
  looksLikeSQL,
  getAssetContentType,
} from './manifest-utils';

export {
  normalizeManifestBundleHash,
  assertManifestWorkerBundleIntegrity,
} from './manifest-integrity';

export {
  parseManifestObjects,
} from './manifest-parsing';

export {
  buildNormalizedManifest,
} from './manifest-builder';

// ---------------------------------------------------------------------------
// Package-level orchestration (zip handling, convenience wrappers)
// ---------------------------------------------------------------------------

async function loadPackageFiles(data: ArrayBuffer): Promise<Map<string, ArrayBuffer>> {
  const jszip = await import('jszip');
  const JSZip = 'default' in jszip ? jszip.default : jszip;
  const zip = await (JSZip as { loadAsync(data: ArrayBuffer): Promise<import('jszip')> }).loadAsync(data);

  const files = new Map<string, ArrayBuffer>();
  // JSZip's type declarations omit `externalFileAttributes`.
  // Cast to a narrow interface that includes only the fields we access.
  interface ZipFileEntry {
    dir: boolean;
    externalFileAttributes: number;
    async(type: 'arraybuffer'): Promise<ArrayBuffer>;
  }
  const zipFiles = zip.files as unknown as Record<string, ZipFileEntry>;

  for (const [filePathRaw, file] of Object.entries(zipFiles)) {
    if (file.dir) continue;

    const filePath = normalizePackagePath(filePathRaw);
    if (!filePath) continue;

    const unixMode = (file.externalFileAttributes >>> 16) & 0xffff;
    if ((unixMode & 0xf000) === 0xa000) {
      throw new Error(`Invalid takopack: symlinks are not allowed (${filePath})`);
    }

    files.set(filePath, await file.async('arraybuffer'));
  }

  return files;
}

export async function parsePackage(data: ArrayBuffer): Promise<ParsedTakopackPackage> {
  const files = await loadPackageFiles(data);

  const manifestBuffer = getPackageFile(files, 'manifest.yaml');
  if (!manifestBuffer) {
    throw new Error('Invalid takopack: manifest.yaml not found');
  }

  const checksumsBuffer = getPackageFile(files, 'checksums.txt');
  if (!checksumsBuffer) {
    throw new Error('Invalid takopack: checksums.txt not found');
  }

  const manifestText = decodeArrayBuffer(manifestBuffer);
  const checksumsText = decodeArrayBuffer(checksumsBuffer);

  const objects = parseManifestObjects(manifestText);
  const checksums = parseChecksums(checksumsText);

  const { manifest, applyReport } = buildNormalizedManifest({
    objects,
    files,
    checksums,
  });

  return {
    manifest,
    files,
    applyReport,
  };
}

export function buildParsedPackageFromParts(params: {
  manifestYaml: string;
  files: Map<string, ArrayBuffer>;
  checksums: Map<string, string>;
}): ParsedTakopackPackage {
  const objects = parseManifestObjects(params.manifestYaml);
  const { manifest, applyReport } = buildNormalizedManifest({
    objects,
    files: params.files,
    checksums: params.checksums,
  });
  return { manifest, files: params.files, applyReport };
}

export async function parseManifestOnly(data: ArrayBuffer): Promise<TakopackManifest> {
  const { manifest } = await parsePackage(data);
  return manifest;
}
