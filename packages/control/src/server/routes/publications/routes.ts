import { Hono } from 'hono';
import { z } from 'zod';
import { eq, inArray } from 'drizzle-orm';
import { type AuthenticatedRouteEnv, requireSpaceAccess } from '../route-auth.ts';
import { zValidator } from '../zod-validator.ts';
import { getDb, type Database } from '../../../infra/db/index.ts';
import {
  bundleDeployments,
  fileHandlerMatchers,
  fileHandlers,
  mcpServers,
} from '../../../infra/db/schema.ts';
import { NotFoundError } from 'takos-common/errors';

/**
 * Publications discovery API.
 *
 * Exposes a read-only view of publication records registered against a space.
 * The Takos kernel does not have a single `publications` table, so this route
 * aggregates rows from the publication-specific tables:
 *   - `mcpServers`          -> type: 'McpServer'
 *   - `fileHandlers` + `fileHandlerMatchers` -> type: 'FileHandler'
 *
 * Space scope resolution:
 *   1. `X-Takos-Space-Id` header (explicit scope)
 *   2. Fallback: the caller's personal space via `loadSpace(db, 'me', user.id)`
 *
 * Group name resolution:
 *   Each publication row stores `bundleDeploymentId` (FK to `bundle_deployments.id`).
 *   We resolve the human-readable group label by joining against `bundle_deployments`
 *   and using its `name` column. This is performed as a single batched fetch per
 *   listing request and a single-row lookup for the `:id` endpoint.
 *
 *   Publications without a linked bundle deployment fall back to the publication
 *   row's own `name` column so that downstream consumers always see a non-empty
 *   group identifier.
 */

/**
 * Batch-resolve `bundle_deployments.name` for a set of bundle deployment ids.
 *
 * Returns a Map keyed by bundle deployment id. Missing rows simply do not
 * appear in the map; the caller is responsible for falling back when a key is
 * absent. Empty input short-circuits with an empty map (no DB roundtrip).
 */
async function loadBundleDeploymentNames(
  db: Database,
  bundleDeploymentIds: Iterable<string>,
): Promise<Map<string, string>> {
  const ids = Array.from(new Set(
    Array.from(bundleDeploymentIds).filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    ),
  ));
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      id: bundleDeployments.id,
      name: bundleDeployments.name,
    })
    .from(bundleDeployments)
    .where(inArray(bundleDeployments.id, ids))
    .all();
  return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * Resolve a human-readable group label for a publication row.
 *
 * Order: bundle deployment name (when the publication is linked to a
 * deployment and the deployment row exists) -> publication's own `name`.
 */
function resolveGroupLabel(
  bundleDeploymentId: string | null,
  fallbackName: string,
  bundleNamesById: Map<string, string>,
): string {
  if (bundleDeploymentId) {
    const resolved = bundleNamesById.get(bundleDeploymentId);
    if (resolved) return resolved;
  }
  return fallbackName;
}

type McpServerPublication = {
  id: string;
  group: string;
  type: 'McpServer';
  url: string;
  path: string;
  transport: string;
  authSecretRef: string | null;
};

type FileHandlerPublication = {
  id: string;
  group: string;
  type: 'FileHandler';
  url: string;
  path: string;
  mimeTypes: string[];
  extensions: string[];
};

type Publication = McpServerPublication | FileHandlerPublication;

const PUBLICATION_TYPES = ['McpServer', 'FileHandler'] as const;
type PublicationType = (typeof PUBLICATION_TYPES)[number];

function isPublicationType(value: string | undefined): value is PublicationType {
  return !!value && (PUBLICATION_TYPES as readonly string[]).includes(value);
}

async function resolveSpaceId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: any,
  userId: string,
): Promise<string> {
  const headerSpaceId = c.req.header('X-Takos-Space-Id');
  if (headerSpaceId) {
    const access = await requireSpaceAccess(c, headerSpaceId, userId);
    return access.space.id;
  }
  // Fallback: personal space for the caller.
  const access = await requireSpaceAccess(c, 'me', userId);
  return access.space.id;
}

const app = new Hono<AuthenticatedRouteEnv>()
  .get(
    '/',
    zValidator(
      'query',
      z.object({
        type: z.string().optional(),
        group: z.string().optional(),
      }),
    ),
    async (c) => {
      const user = c.get('user');
      const { type, group } = c.req.valid('query');
      const spaceId = await resolveSpaceId(c, user.id);
      const db = getDb(c.env.DB);

      const publications: Publication[] = [];

      const typeFilter = isPublicationType(type) ? type : undefined;
      const wantMcp = !typeFilter || typeFilter === 'McpServer';
      const wantFileHandler = !typeFilter || typeFilter === 'FileHandler';

      // Fetch publication rows first, then resolve group labels in a single
      // batched bundle_deployments query (regardless of how many publication
      // tables we hit). This keeps the listing endpoint at O(1) joins instead
      // of O(N) per-row lookups.
      const mcpRows = wantMcp
        ? await db
          .select()
          .from(mcpServers)
          .where(eq(mcpServers.accountId, spaceId))
          .all()
        : [];

      const fhRows = wantFileHandler
        ? await db
          .select()
          .from(fileHandlers)
          .where(eq(fileHandlers.accountId, spaceId))
          .all()
        : [];

      const bundleDeploymentIds: string[] = [];
      for (const row of mcpRows) {
        if (row.bundleDeploymentId) bundleDeploymentIds.push(row.bundleDeploymentId);
      }
      for (const row of fhRows) {
        if (row.bundleDeploymentId) bundleDeploymentIds.push(row.bundleDeploymentId);
      }
      const bundleNamesById = await loadBundleDeploymentNames(db, bundleDeploymentIds);

      // ---- McpServer publications ----
      if (wantMcp) {
        for (const row of mcpRows) {
          const resolvedGroup = resolveGroupLabel(
            row.bundleDeploymentId,
            row.name,
            bundleNamesById,
          );
          if (group && resolvedGroup !== group) continue;
          publications.push({
            id: row.id,
            group: resolvedGroup,
            type: 'McpServer',
            url: row.url,
            path: '/mcp',
            transport: row.transport,
            // Secret material is kept in mcpServers columns directly; there
            // is no stable opaque ref to expose today. Future work: surface a
            // token reference via the OAuth token store.
            authSecretRef: null,
          });
        }
      }

      // ---- FileHandler publications ----
      if (wantFileHandler) {
        const fhIds = fhRows.map((r) => r.id);
        const matcherRows = fhIds.length > 0
          ? (await Promise.all(
            fhIds.map((id) =>
              db
                .select()
                .from(fileHandlerMatchers)
                .where(eq(fileHandlerMatchers.fileHandlerId, id))
                .all()
            ),
          )).flat()
          : [];

        const matchersByHandler = new Map<string, typeof matcherRows>();
        for (const m of matcherRows) {
          const list = matchersByHandler.get(m.fileHandlerId) ?? [];
          list.push(m);
          matchersByHandler.set(m.fileHandlerId, list);
        }

        for (const row of fhRows) {
          const resolvedGroup = resolveGroupLabel(
            row.bundleDeploymentId,
            row.name,
            bundleNamesById,
          );
          if (group && resolvedGroup !== group) continue;
          const matchers = matchersByHandler.get(row.id) ?? [];
          publications.push({
            id: row.id,
            group: resolvedGroup,
            type: 'FileHandler',
            url: `https://${row.serviceHostname}${row.openPath}`,
            path: row.openPath,
            mimeTypes: matchers
              .filter((m) => m.kind === 'mime')
              .map((m) => m.value),
            extensions: matchers
              .filter((m) => m.kind === 'extension')
              .map((m) => m.value),
          });
        }
      }

      return c.json({ publications });
    },
  )
  .get('/:id', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const db = getDb(c.env.DB);

    // The caller's space scope still gates the lookup even though we query by
    // id first. We resolve the scope once and then verify ownership.
    const spaceId = await resolveSpaceId(c, user.id);

    // Try McpServer first.
    const mcp = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, id))
      .get();
    if (mcp) {
      if (mcp.accountId !== spaceId) {
        throw new NotFoundError('Publication');
      }
      const bundleNamesById = await loadBundleDeploymentNames(
        db,
        mcp.bundleDeploymentId ? [mcp.bundleDeploymentId] : [],
      );
      const body: McpServerPublication = {
        id: mcp.id,
        group: resolveGroupLabel(
          mcp.bundleDeploymentId,
          mcp.name,
          bundleNamesById,
        ),
        type: 'McpServer',
        url: mcp.url,
        path: '/mcp',
        transport: mcp.transport,
        authSecretRef: null,
      };
      return c.json(body);
    }

    // Fall back to FileHandler lookup.
    const fh = await db
      .select()
      .from(fileHandlers)
      .where(eq(fileHandlers.id, id))
      .get();
    if (fh) {
      if (fh.accountId !== spaceId) {
        throw new NotFoundError('Publication');
      }
      const matchers = await db
        .select()
        .from(fileHandlerMatchers)
        .where(eq(fileHandlerMatchers.fileHandlerId, id))
        .all();
      const bundleNamesById = await loadBundleDeploymentNames(
        db,
        fh.bundleDeploymentId ? [fh.bundleDeploymentId] : [],
      );
      const body: FileHandlerPublication = {
        id: fh.id,
        group: resolveGroupLabel(
          fh.bundleDeploymentId,
          fh.name,
          bundleNamesById,
        ),
        type: 'FileHandler',
        url: `https://${fh.serviceHostname}${fh.openPath}`,
        path: fh.openPath,
        mimeTypes: matchers
          .filter((m) => m.kind === 'mime')
          .map((m) => m.value),
        extensions: matchers
          .filter((m) => m.kind === 'extension')
          .map((m) => m.value),
      };
      return c.json(body);
    }

    throw new NotFoundError('Publication');
  });

export default app;
