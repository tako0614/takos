import type { Workspace } from '../types';

const normalize = (value?: string) => (value || '').trim().toLowerCase();

export function normalizeWorkspace(workspace: Workspace): Workspace {
  return {
    ...workspace,
    is_personal: workspace.kind === 'user' || workspace.is_personal === true,
  };
}

export function normalizeWorkspaces(workspaces: Workspace[]): Workspace[] {
  return workspaces.map(normalizeWorkspace);
}

function isPersonalWorkspace(workspace: Workspace, personalLabel?: string): boolean {
  if (workspace.kind === 'user' || workspace.is_personal) return true;
  const normalizedName = normalize(workspace.name);
  if (!normalizedName) return false;
  const normalizedLabel = normalize(personalLabel);
  return normalizedName === 'personal' || (!!normalizedLabel && normalizedName === normalizedLabel);
}

export function getPersonalWorkspace(spaces: Workspace[], personalLabel?: string): Workspace | null {
  return spaces.find((workspace) => isPersonalWorkspace(workspace, personalLabel)) || null;
}

export function splitWorkspaces(spaces: Workspace[], personalLabel?: string): {
  personalWorkspace: Workspace | null;
  otherWorkspaces: Workspace[];
} {
  const personalWorkspace = getPersonalWorkspace(spaces, personalLabel);
  const otherWorkspaces = personalWorkspace
    ? spaces.filter((workspace) => workspace.slug !== personalWorkspace.slug)
    : spaces;
  return { personalWorkspace, otherWorkspaces };
}

/** Returns "me" for user workspaces, otherwise the workspace slug. */
export function getWorkspaceIdentifier(workspace: Workspace): string {
  if (workspace.kind === 'user' || workspace.is_personal) return 'me';
  return workspace.slug;
}

export function findWorkspaceByIdentifier(
  spaces: Workspace[],
  identifier: string,
  personalLabel?: string
): Workspace | null {
  if (identifier === 'me') {
    return getPersonalWorkspace(spaces, personalLabel);
  }
  return spaces.find((w) => w.slug === identifier) || null;
}
