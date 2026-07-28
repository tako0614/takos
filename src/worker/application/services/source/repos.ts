import type {
  ObjectStoreBinding,
  SqlDatabaseBinding,
} from "../../../shared/types/bindings.ts";
import type {
  Repository,
  RepositoryVisibility,
} from "../../../shared/types/index.ts";
import { accounts, repositories } from "../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";
import { sourceServiceDeps } from "./deps.ts";
import { toApiRepositoryFromDb } from "./repository-read.ts";

export {
  checkRepoAccess,
  getRepositoryById,
  listRepositoriesBySpace,
  toApiRepositoryFromDb,
} from "./repository-read.ts";
export type { CheckRepoAccessOptions, RepoAccess } from "./repository-read.ts";

export interface CreateRepositoryInput {
  spaceId: string;
  name: string;
  description?: string | null;
  visibility?: RepositoryVisibility | "internal";
  actorAccountId?: string;
}

export class RepositoryCreationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_NAME"
      | "SPACE_NOT_FOUND"
      | "REPOSITORY_EXISTS"
      | "GIT_STORAGE_NOT_CONFIGURED"
      | "INIT_FAILED",
  ) {
    super(message);
    this.name = "RepositoryCreationError";
  }
}

type SourceDrizzleDb = ReturnType<typeof sourceServiceDeps.getDb>;

async function resolveRepositoryInitActor(
  db: SourceDrizzleDb,
  actorAccountId?: string,
): Promise<{ name: string; email: string }> {
  if (!actorAccountId) {
    return {
      name: "Takos Agent",
      email: "agent@users.takos.local",
    };
  }

  const actor = await db
    .select({
      name: accounts.name,
      slug: accounts.slug,
      email: accounts.email,
    })
    .from(accounts)
    .where(eq(accounts.id, actorAccountId))
    .get();

  if (!actor) {
    return {
      name: "Takos Agent",
      email: "agent@users.takos.local",
    };
  }

  const fallbackLocalPart = actor.slug?.trim() || actorAccountId;

  return {
    name: actor.name || "Takos Agent",
    email: actor.email || `${fallbackLocalPart}@users.takos.local`,
  };
}

export async function createRepository(
  dbBinding: SqlDatabaseBinding,
  bucket: ObjectStoreBinding | undefined,
  input: CreateRepositoryInput,
): Promise<Repository> {
  const db = sourceServiceDeps.getDb(dbBinding);
  const name = sourceServiceDeps.sanitizeRepoName(input.name);

  if (!name) {
    throw new RepositoryCreationError(
      "Invalid repository name",
      "INVALID_NAME",
    );
  }

  const space = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, input.spaceId))
    .get();

  if (!space) {
    throw new RepositoryCreationError("Space not found", "SPACE_NOT_FOUND");
  }

  const existing = await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(
      and(
        eq(repositories.accountId, input.spaceId),
        eq(repositories.name, name),
      ),
    )
    .get();

  if (existing) {
    throw new RepositoryCreationError(
      "Repository with this name already exists",
      "REPOSITORY_EXISTS",
    );
  }

  if (!bucket) {
    throw new RepositoryCreationError(
      "Git storage not configured",
      "GIT_STORAGE_NOT_CONFIGURED",
    );
  }

  const id = sourceServiceDeps.generateId();
  const timestamp = new Date().toISOString();
  const actor = await resolveRepositoryInitActor(db, input.actorAccountId);

  await db.insert(repositories).values({
    id,
    accountId: input.spaceId,
    name,
    description: input.description || null,
    visibility: input.visibility || "private",
    defaultBranch: "main",
    stars: 0,
    forks: 0,
    gitEnabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  try {
    await sourceServiceDeps.gitStore.initRepository(
      dbBinding,
      bucket,
      id,
      "main",
      {
        name: actor.name,
        email: actor.email,
        timestamp: Math.floor(new Date(timestamp).getTime() / 1000),
        tzOffset: "+0000",
      },
    );
  } catch (error) {
    await db.delete(repositories).where(eq(repositories.id, id));
    sourceServiceDeps.logError("Failed to initialize repository", error, {
      module: "services/source/repos",
    });
    throw new RepositoryCreationError(
      "Failed to initialize repository",
      "INIT_FAILED",
    );
  }

  const row = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, id))
    .get();
  if (!row) {
    throw new RepositoryCreationError(
      "Failed to create repository",
      "INIT_FAILED",
    );
  }

  return toApiRepositoryFromDb(row);
}
