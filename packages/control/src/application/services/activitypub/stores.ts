import { and, eq, like } from 'drizzle-orm';
import type { D1Database } from '../../../shared/types/bindings.ts';
import { accountMetadata, accounts, getDb } from '../../../infra/db';
import { now } from '../../../shared/utils';

const STORE_KEY_PREFIX = 'activitypub_store:';

export interface ActivityPubStoreDefinition {
  accountId: string;
  accountSlug: string;
  slug: string;
  name: string;
  summary: string | null;
  iconUrl: string | null;
  createdAt: string;
  updatedAt: string;
  isDefault: boolean;
}

export interface UpsertActivityPubStoreInput {
  slug: string;
  name?: string | null;
  summary?: string | null;
  iconUrl?: string | null;
}

interface StoredActivityPubStoreRecord {
  version: 1;
  slug: string;
  name: string | null;
  summary: string | null;
  iconUrl: string | null;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeActivityPubStoreSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

function buildStoreMetadataKey(slug: string): string {
  return `${STORE_KEY_PREFIX}${slug}`;
}

function parseStoredActivityPubStoreRecord(
  slug: string,
  rawValue: string,
): StoredActivityPubStoreRecord {
  try {
    const parsed = JSON.parse(rawValue) as Partial<StoredActivityPubStoreRecord> | null;
    return {
      version: 1,
      slug,
      name: normalizeOptionalText(parsed?.name) ?? null,
      summary: normalizeOptionalText(parsed?.summary) ?? null,
      iconUrl: normalizeOptionalText(parsed?.iconUrl) ?? null,
    };
  } catch {
    return {
      version: 1,
      slug,
      name: null,
      summary: null,
      iconUrl: null,
    };
  }
}

function serializeStoredActivityPubStoreRecord(
  slug: string,
  input: { name?: string | null; summary?: string | null; iconUrl?: string | null },
): string {
  const record: StoredActivityPubStoreRecord = {
    version: 1,
    slug,
    name: normalizeOptionalText(input.name),
    summary: normalizeOptionalText(input.summary),
    iconUrl: normalizeOptionalText(input.iconUrl),
  };
  return JSON.stringify(record);
}

function buildDefaultStoreDefinition(account: {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  picture: string | null;
  createdAt: string;
  updatedAt: string;
}): ActivityPubStoreDefinition {
  return {
    accountId: account.id,
    accountSlug: account.slug,
    slug: account.slug,
    name: account.name,
    summary: normalizeOptionalText(account.description),
    iconUrl: normalizeOptionalText(account.picture),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    isDefault: true,
  };
}

function buildCustomStoreDefinition(
  account: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    picture: string | null;
  },
  metadataRow: {
    value: string;
    createdAt: string;
    updatedAt: string;
  },
  slug: string,
): ActivityPubStoreDefinition {
  const parsed = parseStoredActivityPubStoreRecord(slug, metadataRow.value);
  return {
    accountId: account.id,
    accountSlug: account.slug,
    slug,
    name: parsed.name ?? account.name,
    summary: parsed.summary ?? normalizeOptionalText(account.description),
    iconUrl: parsed.iconUrl ?? normalizeOptionalText(account.picture),
    createdAt: metadataRow.createdAt,
    updatedAt: metadataRow.updatedAt,
    isDefault: false,
  };
}

async function getAccountById(dbBinding: D1Database, accountId: string) {
  const db = getDb(dbBinding);
  return db.select({
    id: accounts.id,
    slug: accounts.slug,
    name: accounts.name,
    description: accounts.description,
    picture: accounts.picture,
    createdAt: accounts.createdAt,
    updatedAt: accounts.updatedAt,
  }).from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1)
    .get();
}

export async function listActivityPubStoresForWorkspace(
  dbBinding: D1Database,
  accountId: string,
): Promise<ActivityPubStoreDefinition[]> {
  const account = await getAccountById(dbBinding, accountId);
  if (!account) {
    return [];
  }

  const db = getDb(dbBinding);
  const rows = await db.select({
    key: accountMetadata.key,
    value: accountMetadata.value,
    createdAt: accountMetadata.createdAt,
    updatedAt: accountMetadata.updatedAt,
  }).from(accountMetadata)
    .where(and(
      eq(accountMetadata.accountId, accountId),
      like(accountMetadata.key, `${STORE_KEY_PREFIX}%`),
    ))
    .all();

  const customStores = rows
    .map((row) => {
      const slug = row.key.slice(STORE_KEY_PREFIX.length).trim().toLowerCase();
      if (!slug) {
        return null;
      }
      return buildCustomStoreDefinition(account, row, slug);
    })
    .filter((store): store is ActivityPubStoreDefinition => store !== null)
    .sort((a, b) => a.slug.localeCompare(b.slug));

  return [buildDefaultStoreDefinition(account), ...customStores];
}

export async function findActivityPubStoreBySlug(
  dbBinding: D1Database,
  storeSlug: string,
): Promise<ActivityPubStoreDefinition | null> {
  const slug = normalizeActivityPubStoreSlug(storeSlug);
  if (!slug) {
    return null;
  }

  const db = getDb(dbBinding);
  const customRow = await db.select({
    accountId: accounts.id,
    accountSlug: accounts.slug,
    accountName: accounts.name,
    accountDescription: accounts.description,
    accountPicture: accounts.picture,
    key: accountMetadata.key,
    value: accountMetadata.value,
    createdAt: accountMetadata.createdAt,
    updatedAt: accountMetadata.updatedAt,
  }).from(accountMetadata)
    .innerJoin(accounts, eq(accountMetadata.accountId, accounts.id))
    .where(eq(accountMetadata.key, buildStoreMetadataKey(slug)))
    .limit(1)
    .get();

  if (customRow) {
    return buildCustomStoreDefinition({
      id: customRow.accountId,
      slug: customRow.accountSlug,
      name: customRow.accountName,
      description: customRow.accountDescription,
      picture: customRow.accountPicture,
    }, {
      value: customRow.value,
      createdAt: customRow.createdAt,
      updatedAt: customRow.updatedAt,
    }, slug);
  }

  const account = await db.select({
    id: accounts.id,
    slug: accounts.slug,
    name: accounts.name,
    description: accounts.description,
    picture: accounts.picture,
    createdAt: accounts.createdAt,
    updatedAt: accounts.updatedAt,
  }).from(accounts)
    .where(eq(accounts.slug, slug))
    .limit(1)
    .get();

  if (!account) {
    return null;
  }

  return buildDefaultStoreDefinition(account);
}

export async function createActivityPubStore(
  dbBinding: D1Database,
  accountId: string,
  input: UpsertActivityPubStoreInput,
): Promise<ActivityPubStoreDefinition> {
  const account = await getAccountById(dbBinding, accountId);
  if (!account) {
    throw new Error('Workspace not found');
  }

  const slug = normalizeActivityPubStoreSlug(input.slug);
  if (!slug) {
    throw new Error('slug is required');
  }

  if (slug === account.slug) {
    throw new Error('slug conflicts with the default store');
  }

  const existing = await findActivityPubStoreBySlug(dbBinding, slug);
  if (existing) {
    throw new Error('store slug already exists');
  }

  const timestamp = now();
  const db = getDb(dbBinding);
  await db.insert(accountMetadata).values({
    accountId,
    key: buildStoreMetadataKey(slug),
    value: serializeStoredActivityPubStoreRecord(slug, input),
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return buildCustomStoreDefinition(account, {
    value: serializeStoredActivityPubStoreRecord(slug, input),
    createdAt: timestamp,
    updatedAt: timestamp,
  }, slug);
}

export async function updateActivityPubStore(
  dbBinding: D1Database,
  accountId: string,
  storeSlug: string,
  input: Omit<UpsertActivityPubStoreInput, 'slug'>,
): Promise<ActivityPubStoreDefinition | null> {
  const account = await getAccountById(dbBinding, accountId);
  if (!account) {
    throw new Error('Workspace not found');
  }

  const slug = normalizeActivityPubStoreSlug(storeSlug);
  if (!slug || slug === account.slug) {
    return null;
  }

  const db = getDb(dbBinding);
  const existing = await db.select({
    value: accountMetadata.value,
    createdAt: accountMetadata.createdAt,
    updatedAt: accountMetadata.updatedAt,
  }).from(accountMetadata)
    .where(and(
      eq(accountMetadata.accountId, accountId),
      eq(accountMetadata.key, buildStoreMetadataKey(slug)),
    ))
    .limit(1)
    .get();

  if (!existing) {
    return null;
  }

  const parsed = parseStoredActivityPubStoreRecord(slug, existing.value);
  const nextValue = serializeStoredActivityPubStoreRecord(slug, {
    name: input.name !== undefined ? input.name : parsed.name,
    summary: input.summary !== undefined ? input.summary : parsed.summary,
    iconUrl: input.iconUrl !== undefined ? input.iconUrl : parsed.iconUrl,
  });
  const timestamp = now();

  await db.update(accountMetadata)
    .set({
      value: nextValue,
      updatedAt: timestamp,
    })
    .where(and(
      eq(accountMetadata.accountId, accountId),
      eq(accountMetadata.key, buildStoreMetadataKey(slug)),
    ));

  return buildCustomStoreDefinition(account, {
    value: nextValue,
    createdAt: existing.createdAt,
    updatedAt: timestamp,
  }, slug);
}

export async function deleteActivityPubStore(
  dbBinding: D1Database,
  accountId: string,
  storeSlug: string,
): Promise<boolean> {
  const account = await getAccountById(dbBinding, accountId);
  if (!account) {
    throw new Error('Workspace not found');
  }

  const slug = normalizeActivityPubStoreSlug(storeSlug);
  if (!slug || slug === account.slug) {
    return false;
  }

  const db = getDb(dbBinding);
  const existing = await db.select({ key: accountMetadata.key }).from(accountMetadata)
    .where(and(
      eq(accountMetadata.accountId, accountId),
      eq(accountMetadata.key, buildStoreMetadataKey(slug)),
    ))
    .limit(1)
    .get();

  if (!existing) {
    return false;
  }

  await db.delete(accountMetadata).where(and(
    eq(accountMetadata.accountId, accountId),
    eq(accountMetadata.key, buildStoreMetadataKey(slug)),
  ));
  return true;
}
