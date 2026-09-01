const STORAGE_PREFIX = "takos:mcp-confirmation-run-grants:v1:";
const OPAQUE_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const MAX_GRANTS_PER_THREAD = 16;

export interface McpConfirmationRunGrant {
  confirmationGrantId: string;
  workspaceId: string;
  threadId: string;
  expiresAt: string;
}

const volatileGrants = new Map<string, McpConfirmationRunGrant[]>();

export function browserSessionStorage(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

function key(workspaceId: string, threadId: string): string | null {
  return OPAQUE_ID.test(workspaceId) && OPAQUE_ID.test(threadId)
    ? `${STORAGE_PREFIX}${workspaceId}:${threadId}`
    : null;
}

function parseGrant(value: unknown): McpConfirmationRunGrant | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 4 ||
    !OPAQUE_ID.test(String(record.confirmationGrantId ?? "")) ||
    !OPAQUE_ID.test(String(record.workspaceId ?? "")) ||
    !OPAQUE_ID.test(String(record.threadId ?? "")) ||
    typeof record.expiresAt !== "string" ||
    record.expiresAt.length > 64 ||
    !Number.isFinite(Date.parse(record.expiresAt))
  ) {
    return null;
  }
  return {
    confirmationGrantId: record.confirmationGrantId as string,
    workspaceId: record.workspaceId as string,
    threadId: record.threadId as string,
    expiresAt: record.expiresAt,
  };
}

function current(
  storage: Storage | undefined,
  workspaceId: string,
  threadId: string,
  now = Date.now(),
): McpConfirmationRunGrant[] {
  const storageKey = key(workspaceId, threadId);
  if (!storageKey) return [];
  let raw: unknown = volatileGrants.get(storageKey) ?? [];
  try {
    const persisted = storage?.getItem(storageKey);
    if (persisted !== null && persisted !== undefined) {
      raw = JSON.parse(persisted) as unknown;
    }
  } catch {
    // The in-memory queue keeps the current page usable when sessionStorage is
    // disabled or contains corrupt data.
  }
  const grants = Array.isArray(raw)
    ? raw.map(parseGrant).filter((item): item is McpConfirmationRunGrant =>
      item !== null && item.workspaceId === workspaceId &&
      item.threadId === threadId && Date.parse(item.expiresAt) > now
    ).slice(0, MAX_GRANTS_PER_THREAD)
    : [];
  volatileGrants.set(storageKey, grants);
  try {
    if (grants.length === 0) storage?.removeItem(storageKey);
    else storage?.setItem(storageKey, JSON.stringify(grants));
  } catch {
    // Volatile state remains authoritative for this page lifetime.
  }
  return grants;
}

export function storeMcpConfirmationRunGrant(
  storage: Storage | undefined,
  grant: McpConfirmationRunGrant,
): void {
  const parsed = parseGrant(grant);
  if (!parsed || Date.parse(parsed.expiresAt) <= Date.now()) {
    throw new TypeError("Invalid MCP confirmation Run grant");
  }
  const storageKey = key(parsed.workspaceId, parsed.threadId);
  if (!storageKey) throw new TypeError("Invalid MCP confirmation Run grant");
  const grants = current(
    storage,
    parsed.workspaceId,
    parsed.threadId,
  ).filter((item) => item.confirmationGrantId !== parsed.confirmationGrantId);
  grants.push(parsed);
  const bounded = grants.slice(-MAX_GRANTS_PER_THREAD);
  volatileGrants.set(storageKey, bounded);
  try {
    storage?.setItem(storageKey, JSON.stringify(bounded));
  } catch {
    // Keep the grant available to this page even without sessionStorage.
  }
}

export function peekMcpConfirmationRunGrant(
  storage: Storage | undefined,
  workspaceId: string,
  threadId: string,
): McpConfirmationRunGrant | null {
  return current(storage, workspaceId, threadId)[0] ?? null;
}

export function removeMcpConfirmationRunGrant(
  storage: Storage | undefined,
  grant: McpConfirmationRunGrant,
): void {
  const storageKey = key(grant.workspaceId, grant.threadId);
  if (!storageKey) return;
  const remaining = current(storage, grant.workspaceId, grant.threadId)
    .filter((item) => item.confirmationGrantId !== grant.confirmationGrantId);
  volatileGrants.set(storageKey, remaining);
  try {
    if (remaining.length === 0) storage?.removeItem(storageKey);
    else storage?.setItem(storageKey, JSON.stringify(remaining));
  } catch {
    // Volatile state was updated even if persistence is unavailable.
  }
}
