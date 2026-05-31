import type { SqlDatabaseBinding } from "takos-api-contract/shared/types";

export type CatalogSuggestionUser = {
  username: string;
  name: string;
  avatar_url: string | null;
};

export type CatalogSuggestionRepo = {
  id: string;
  name: string;
  description: string | null;
  stars: number;
  updated_at: string;
  owner: {
    username: string;
    name: string | null;
    avatar_url: string | null;
  };
};

export type CatalogSuggestions = {
  users: CatalogSuggestionUser[];
  repos: CatalogSuggestionRepo[];
};

export async function buildCatalogSuggestions(
  db: SqlDatabaseBinding,
  q: string,
  limit: number,
): Promise<CatalogSuggestions> {
  const pattern = `%${q}%`;
  const [users, repos] = await Promise.all([
    db.prepare(`
      SELECT
        slug,
        name,
        picture
      FROM accounts
      WHERE slug != '' AND (slug LIKE ? OR name LIKE ?)
      ORDER BY slug ASC
      LIMIT ?
    `).bind(pattern, pattern, limit).all<Record<string, unknown>>(),
    db.prepare(`
      SELECT
        r.id,
        r.name,
        r.description,
        r.stars,
        r.updated_at AS updatedAt,
        r.account_id AS accountId,
        a.slug AS accountSlug,
        a.name AS accountName,
        a.picture AS accountPicture
      FROM repositories r
      LEFT JOIN accounts a ON a.id = r.account_id
      WHERE r.visibility = 'public'
        AND (r.name LIKE ? OR r.description LIKE ?)
      ORDER BY r.stars DESC, r.updated_at DESC
      LIMIT ?
    `).bind(pattern, pattern, limit).all<Record<string, unknown>>(),
  ]);

  return {
    users: users.results.flatMap((row) => {
      const slug = nullableStringField(row, "slug");
      if (!slug) return [];
      return [{
        username: slug,
        name: stringField(row, "name"),
        avatar_url: nullableStringField(row, "picture"),
      }];
    }),
    repos: repos.results.flatMap((row) => {
      const ownerSlug = nullableStringField(row, "accountSlug") ??
        nullableStringField(row, "accountId");
      if (!ownerSlug) return [];
      return [{
        id: stringField(row, "id"),
        name: stringField(row, "name"),
        description: nullableStringField(row, "description"),
        stars: numberField(row, "stars"),
        updated_at: stringField(row, "updatedAt"),
        owner: {
          username: ownerSlug,
          name: nullableStringField(row, "accountName"),
          avatar_url: nullableStringField(row, "accountPicture"),
        },
      }];
    }),
  };
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  throw new TypeError(`Suggestion row field ${key} must be a string`);
}

function nullableStringField(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value === "string") return value;
  throw new TypeError(`Suggestion row field ${key} must be a string or null`);
}

function numberField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new TypeError(`Suggestion row field ${key} must be a number`);
}
