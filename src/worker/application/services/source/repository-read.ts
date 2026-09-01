import type {
  Env,
  Repository,
} from "../../../shared/types/index.ts";
import type { SelectOf } from "../../../shared/types/drizzle-utils.ts";
import { repositories, type SqlDatabaseLike } from "../../../infra/db/index.ts";
import { desc, eq } from "drizzle-orm";
import { isValidOpaqueId } from "../../../shared/utils/db-guards.ts";
import { sourceServiceDeps } from "./deps.ts";

export interface RepoAccess {
  repo: Repository;
  spaceId: string;
  accessKind: "owner" | "public-read";
}

export interface CheckRepoAccessOptions {
  allowPublicRead?: boolean;
}

type RepositoryRow = SelectOf<typeof repositories>;

function toRepositoryVisibility(value: string): "public" | "private" {
  return value === "public" ? "public" : "private";
}

export function toApiRepositoryFromDb(row: RepositoryRow): Repository {
  const repository = {
    id: row.id,
    space_id: row.accountId,
    name: row.name,
    description: row.description,
    visibility: toRepositoryVisibility(row.visibility),
    default_branch: row.defaultBranch,
    forked_from_id: row.forkedFromId,
    stars: row.stars,
    forks: row.forks,
    git_enabled: row.gitEnabled,
    featured: row.featured,
    install_count: row.installCount,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };

  return repository;
}

export async function checkRepoAccess(
  env: Pick<Env, "DB">,
  repoId: string,
  userId: string | null | undefined,
  options: CheckRepoAccessOptions = {},
): Promise<RepoAccess | null> {
  if (!isValidOpaqueId(repoId)) return null;

  const normalizedUserId =
    typeof userId === "string" && isValidOpaqueId(userId) ? userId : null;

  const drizzle = sourceServiceDeps.getDb(env.DB);
  const row = await drizzle
    .select()
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .get();
  const repo = row ? toApiRepositoryFromDb(row) : null;

  if (!repo) return null;

  if (normalizedUserId) {
    const access = await sourceServiceDeps.checkSpaceAccess(
      env.DB,
      repo.space_id,
      normalizedUserId,
    );
    if (access) {
      return { repo, spaceId: repo.space_id, accessKind: "owner" };
    }
  }

  if (
    options.allowPublicRead &&
    repo.visibility === "public"
  ) {
    return { repo, spaceId: repo.space_id, accessKind: "public-read" };
  }

  return null;
}

export async function getRepositoryById(
  db: SqlDatabaseLike,
  repoId: string,
): Promise<Repository | null> {
  if (!isValidOpaqueId(repoId)) return null;

  const drizzle = sourceServiceDeps.getDb(db);
  const row = await drizzle
    .select()
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .get();
  return row ? toApiRepositoryFromDb(row) : null;
}

export async function listRepositoriesBySpace(
  db: SqlDatabaseLike,
  spaceId: string,
): Promise<Repository[]> {
  const drizzle = sourceServiceDeps.getDb(db);
  const rows = await drizzle
    .select()
    .from(repositories)
    .where(eq(repositories.accountId, spaceId))
    .orderBy(desc(repositories.updatedAt))
    .all();
  return rows.map(toApiRepositoryFromDb);
}
