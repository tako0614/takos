export type WorkspaceSecurityPosture = "standard" | "restricted_egress";

export const MAX_WORKSPACE_ID_CHARACTERS = 128;
export const MAX_WORKSPACE_SLUG_CHARACTERS = 32;
export const MAX_WORKSPACE_NAME_CHARACTERS = 120;
export const MAX_WORKSPACE_DESCRIPTION_CHARACTERS = 2_000;

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isDefault: boolean;
  securityPosture: WorkspaceSecurityPosture;
  createdAt: string;
  updatedAt: string;
}

export type NewWorkspace = Workspace;

export interface WorkspacePersistence {
  isWorkspaceIdAvailable(id: string): Promise<boolean>;
  isWorkspaceSlugAvailable(slug: string): Promise<boolean>;
  createForPrincipal(
    principalId: string,
    workspace: NewWorkspace,
  ): Promise<Workspace>;
  listForPrincipal(principalId: string): Promise<readonly Workspace[]>;
  resolveForPrincipal(
    principalId: string,
    idOrSlug: string,
  ): Promise<Workspace | null>;
  updateForPrincipal(
    principalId: string,
    workspaceId: string,
    updates: WorkspacePatch,
  ): Promise<Workspace | null>;
  deleteForPrincipal(
    principalId: string,
    workspaceId: string,
  ): Promise<boolean>;
}

export interface WorkspaceClock {
  now(): string;
}

export interface WorkspaceIds {
  nextWorkspaceId(): string;
}

export interface CreateWorkspaceInput {
  id?: string;
  name: string;
  description?: string | null;
}

export interface UpdateWorkspaceInput {
  name?: string;
  description?: string | null;
  securityPosture?: WorkspaceSecurityPosture;
}

export interface WorkspacePatch extends UpdateWorkspaceInput {
  updatedAt: string;
}
