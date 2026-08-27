import type {
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  Workspace,
  WorkspaceClock,
  WorkspaceIds,
  WorkspacePersistence,
} from "./types.ts";
import {
  MAX_WORKSPACE_DESCRIPTION_CHARACTERS,
  MAX_WORKSPACE_ID_CHARACTERS,
  MAX_WORKSPACE_NAME_CHARACTERS,
  MAX_WORKSPACE_SLUG_CHARACTERS,
} from "./types.ts";

export interface WorkspaceCore {
  create(
    principalId: string,
    input: CreateWorkspaceInput,
  ): Promise<Workspace>;
  list(principalId: string): Promise<readonly Workspace[]>;
  resolve(principalId: string, idOrSlug: string): Promise<Workspace | null>;
  update(
    principalId: string,
    idOrSlug: string,
    input: UpdateWorkspaceInput,
  ): Promise<Workspace | null>;
  delete(principalId: string, idOrSlug: string): Promise<boolean>;
}

export interface WorkspaceCoreDependencies {
  persistence: WorkspacePersistence;
  clock: WorkspaceClock;
  ids: WorkspaceIds;
}

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export class WorkspaceInputError extends Error {
  readonly code = "invalid_workspace_input";

  constructor(message: string) {
    super(message);
    this.name = "WorkspaceInputError";
  }
}

function normalizeOpaqueId(value: string, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    !normalized || normalized.length > MAX_WORKSPACE_ID_CHARACTERS ||
    !OPAQUE_ID_PATTERN.test(normalized)
  ) {
    throw new WorkspaceInputError(`${label} is invalid`);
  }
  return normalized;
}

function normalizeWorkspaceName(value: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > MAX_WORKSPACE_NAME_CHARACTERS) {
    throw new WorkspaceInputError("Workspace name is invalid");
  }
  return normalized;
}

function normalizeWorkspaceDescription(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string") {
    throw new WorkspaceInputError("Workspace description is invalid");
  }
  const normalized = value.trim();
  if (normalized.length > MAX_WORKSPACE_DESCRIPTION_CHARACTERS) {
    throw new WorkspaceInputError("Workspace description is invalid");
  }
  return normalized || null;
}

function normalizeSecurityPosture(value: unknown) {
  if (value === undefined) return undefined;
  if (value !== "standard" && value !== "restricted_egress") {
    throw new WorkspaceInputError("Workspace security posture is invalid");
  }
  return value;
}

function slugifyWorkspaceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_WORKSPACE_SLUG_CHARACTERS) || "workspace";
}

function withSlugSuffix(base: string, suffix: string): string {
  const marker = `-${suffix}`;
  return `${base.slice(0, MAX_WORKSPACE_SLUG_CHARACTERS - marker.length)}${marker}`;
}

async function chooseSlug(
  persistence: WorkspacePersistence,
  name: string,
  workspaceId: string,
): Promise<string> {
  const base = slugifyWorkspaceName(name);
  if (await persistence.isWorkspaceSlugAvailable(base)) return base;

  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const candidate = withSlugSuffix(base, String(suffix));
    if (await persistence.isWorkspaceSlugAvailable(candidate)) {
      return candidate;
    }
  }

  const fallback = withSlugSuffix(base, workspaceId.slice(0, 6).toLowerCase());
  if (await persistence.isWorkspaceSlugAvailable(fallback)) return fallback;
  throw new Error("Unable to allocate a unique Workspace slug");
}

export function createWorkspaceCore(
  dependencies: WorkspaceCoreDependencies,
): WorkspaceCore {
  const { persistence, clock, ids } = dependencies;

  return {
    async create(principalId, input) {
      const normalizedPrincipalId = normalizeOpaqueId(
        principalId,
        "Principal ID",
      );
      const workspaceId = normalizeOpaqueId(
        input.id ?? ids.nextWorkspaceId(),
        "Workspace ID",
      );
      if (!(await persistence.isWorkspaceIdAvailable(workspaceId))) {
        throw new Error("Workspace ID already exists");
      }

      const name = normalizeWorkspaceName(input.name);
      const description = normalizeWorkspaceDescription(input.description);
      const timestamp = clock.now();
      return await persistence.createForPrincipal(normalizedPrincipalId, {
        id: workspaceId,
        name,
        slug: await chooseSlug(persistence, name, workspaceId),
        description: description ?? null,
        isDefault: false,
        securityPosture: "standard",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    },

    async list(principalId) {
      return await persistence.listForPrincipal(
        normalizeOpaqueId(principalId, "Principal ID"),
      );
    },

    async resolve(principalId, idOrSlug) {
      return await persistence.resolveForPrincipal(
        normalizeOpaqueId(principalId, "Principal ID"),
        normalizeOpaqueId(idOrSlug, "Workspace ID"),
      );
    },

    async update(principalId, idOrSlug, input) {
      const normalizedPrincipalId = normalizeOpaqueId(
        principalId,
        "Principal ID",
      );
      const selector = normalizeOpaqueId(idOrSlug, "Workspace ID");
      const current = await persistence.resolveForPrincipal(
        normalizedPrincipalId,
        selector,
      );
      if (!current) return null;

      const name = input.name === undefined
        ? undefined
        : normalizeWorkspaceName(input.name);
      const description = normalizeWorkspaceDescription(input.description);
      const securityPosture = normalizeSecurityPosture(input.securityPosture);

      return await persistence.updateForPrincipal(
        normalizedPrincipalId,
        current.id,
        {
          ...(name === undefined ? {} : { name }),
          ...(description === undefined ? {} : { description }),
          ...(securityPosture === undefined ? {} : { securityPosture }),
          updatedAt: clock.now(),
        },
      );
    },

    async delete(principalId, idOrSlug) {
      const normalizedPrincipalId = normalizeOpaqueId(
        principalId,
        "Principal ID",
      );
      const current = await persistence.resolveForPrincipal(
        normalizedPrincipalId,
        normalizeOpaqueId(idOrSlug, "Workspace ID"),
      );
      if (!current || current.isDefault) return false;
      return await persistence.deleteForPrincipal(
        normalizedPrincipalId,
        current.id,
      );
    },
  };
}
