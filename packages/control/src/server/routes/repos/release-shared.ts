import { getDb } from '../../../infra/db';
import { repoReleases, repoReleaseAssets, accounts } from '../../../infra/db/schema';
import { eq, asc } from 'drizzle-orm';
import { MAX_RELEASE_ASSET_FILENAME_LENGTH } from '../../../shared/config/limits';

export function sanitizeReleaseAssetFilename(fileName: string): string {
  const normalized = fileName
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\\/g, '/');

  const basename = normalized.split('/').pop() || '';
  const withoutTraversal = basename.replace(/\.\.+/g, '.');
  const collapsed = withoutTraversal.replace(/\s+/g, ' ').trim();
  const safe = collapsed
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, MAX_RELEASE_ASSET_FILENAME_LENGTH);

  return safe || 'asset.bin';
}

export function buildAttachmentDisposition(fileName: string): string {
  const sanitized = sanitizeReleaseAssetFilename(fileName);
  const asciiFallback = sanitized.replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(sanitized)
    .replace(/['()]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, '%2A');

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/** Fetch a release with its assets and author in separate queries */
export async function fetchReleaseWithDetails(
  db: ReturnType<typeof getDb>,
  releaseId: string,
) {
  const release = await db.select().from(repoReleases).where(eq(repoReleases.id, releaseId)).get();
  if (!release) return null;

  const assets = await db.select().from(repoReleaseAssets)
    .where(eq(repoReleaseAssets.releaseId, releaseId))
    .orderBy(asc(repoReleaseAssets.createdAt))
    .all();

  let author: { id: string; name: string; picture: string | null } | null = null;
  if (release.authorAccountId) {
    const authorData = await db.select({
      id: accounts.id,
      name: accounts.name,
      picture: accounts.picture,
    }).from(accounts).where(eq(accounts.id, release.authorAccountId)).get();
    author = authorData ?? null;
  }

  return { ...release, repoReleaseAssets: assets, authorAccount: author };
}
