import { getDb } from '../../../infra/db';
import { edges, nodes, files } from '../../../infra/db/schema';
import { eq, and, or, inArray } from 'drizzle-orm';
import type { D1Database } from '../../../shared/types/bindings.ts';
import type { SpaceFile } from '../../../shared/types';
import { checkSpaceAccess, generateId } from '../../../shared/utils';
import type { IndexContext } from './index-context';
import { resolvePath } from './index-context';
import { BadRequestError, NotFoundError } from 'takos-common/errors';

export async function handleGraphNeighbors(c: IndexContext): Promise<Response> {
  const user = c.get('user');
  const spaceId = c.req.param('spaceId');
  if (!spaceId) throw new BadRequestError('Missing spaceId');
  const nodeId = c.req.query('node_id');
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Math.min(Math.max(1, parseInt(limitParam) || 100), 500) : 100;

  const access = await checkSpaceAccess(c.env.DB, spaceId, user.id);
  if (!access) {
    throw new NotFoundError('Workspace');
  }
  if (!nodeId) {
    throw new BadRequestError('node_id is required');
  }

  const db = getDb(c.env.DB);
  const edgeRows = await db.select().from(edges).where(
    and(
      eq(edges.accountId, spaceId),
      or(eq(edges.sourceId, nodeId), eq(edges.targetId, nodeId)),
    )
  ).limit(limit).all();

  const connectedIds = new Set<string>();
  for (const edge of edgeRows) {
    if (edge.sourceId !== nodeId) connectedIds.add(edge.sourceId);
    if (edge.targetId !== nodeId) connectedIds.add(edge.targetId);
  }

  const idsToFetch = Array.from(connectedIds).slice(0, limit);
  const nodeRows = idsToFetch.length > 0
    ? await db.select().from(nodes).where(inArray(nodes.id, idsToFetch)).all()
    : [];

  return c.json({
    node_id: nodeId,
    edges: edgeRows,
    neighbors: nodeRows,
    limit,
    has_more: connectedIds.size > limit,
  });
}

export async function extractAndCreateEdges(
  db: D1Database,
  spaceId: string,
  file: SpaceFile,
  content: string,
  sourceNodeId: string
): Promise<void> {
  const drizzle = getDb(db);
  const timestamp = new Date().toISOString();
  const ext = file.path.split('.').pop()?.toLowerCase();
  const imports: string[] = [];

  if (ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx') {
    const importRegex = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }
  } else if (ext === 'py') {
    const importRegex = /(?:from\s+(\S+)\s+import|import\s+(\S+))/g;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1] || match[2]);
    }
  }

  for (const importPath of imports) {
    const possiblePaths = [
      importPath,
      `${importPath}.ts`,
      `${importPath}.tsx`,
      `${importPath}.js`,
      `${importPath}/index.ts`,
      `${importPath}/index.js`,
    ];

    for (const path of possiblePaths) {
      const normalizedPath =
        path.startsWith('./') || path.startsWith('../') ? resolvePath(file.path, path) : path;
      const targetFile = await drizzle.select({ id: files.id }).from(files).where(
        and(eq(files.accountId, spaceId), eq(files.path, normalizedPath))
      ).get();

      if (!targetFile) {
        continue;
      }

      const targetNode = await drizzle.select({ id: nodes.id }).from(nodes).where(
        and(eq(nodes.accountId, spaceId), eq(nodes.type, 'file'), eq(nodes.refId, targetFile.id))
      ).get();

      if (targetNode) {
        const edgeId = generateId();
        await drizzle.insert(edges).values({
          id: edgeId,
          accountId: spaceId,
          sourceId: sourceNodeId,
          targetId: targetNode.id,
          type: 'imports',
          weight: 1.0,
          metadata: '{}',
          createdAt: timestamp,
        });
      }
      break;
    }
  }
}
