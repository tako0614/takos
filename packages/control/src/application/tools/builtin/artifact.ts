import type { ToolDefinition, ToolHandler } from '../tool-definitions.ts';
import type { ArtifactType } from '../../../shared/types/index.ts';
import { getDb, artifacts, files } from '../../../infra/db/index.ts';
import { eq, and, ne, like, desc, asc } from 'drizzle-orm';
import { generateId } from '../../../shared/utils/index.ts';

export const CREATE_ARTIFACT: ToolDefinition = {
  name: 'create_artifact',
  description: 'Create an artifact (code, document, report, etc.) as output of this run. Artifacts are displayed to the user and can be downloaded.',
  category: 'artifact',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Artifact type',
        enum: ['code', 'config', 'doc', 'patch', 'report', 'other'],
      },
      title: {
        type: 'string',
        description: 'Title of the artifact',
      },
      content: {
        type: 'string',
        description: 'Content of the artifact',
      },
    },
    required: ['type', 'title', 'content'],
  },
};

export const SEARCH: ToolDefinition = {
  name: 'search',
  description: 'Search for files and content in the workspace',
  category: 'artifact',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
      type: {
        type: 'string',
        description: 'Search type: "filename" for file names, "content" for file contents',
        enum: ['filename', 'content'],
      },
    },
    required: ['query'],
  },
};

export const createArtifactHandler: ToolHandler = async (args, context) => {
  const type = args.type as ArtifactType;
  const title = args.title as string;
  const content = args.content as string;

  const id = generateId();
  const now = new Date().toISOString();

  const db = getDb(context.db);
  await db.insert(artifacts).values({
    id,
    runId: context.runId,
    accountId: context.spaceId,
    type,
    title,
    content,
    metadata: '{}',
    createdAt: now,
  });

  return `Created artifact: ${title} (${type})`;
};

export const searchHandler: ToolHandler = async (args, context) => {
  const query = args.query as string;
  const type = (args.type as string) || 'content';

  const db = getDb(context.db);

  if (type === 'filename') {
    const fileResults = await db.select({ path: files.path, size: files.size, kind: files.kind })
      .from(files)
      .where(and(eq(files.accountId, context.spaceId), like(files.path, `%${query}%`), ne(files.origin, 'system')))
      .orderBy(asc(files.path))
      .limit(20)
      .all();

    if (fileResults.length === 0) {
      return `No files matching "${query}"`;
    }

    return `Found ${fileResults.length} files:\n` + fileResults.map(f => `- ${f.path}`).join('\n');
  } else {
    const fileResults = await db.select({ id: files.id, path: files.path })
      .from(files)
      .where(and(
        eq(files.accountId, context.spaceId),
        ne(files.origin, 'system'),
      ))
      .orderBy(desc(files.updatedAt))
      .limit(50)
      .all();

    if (fileResults.length === 0) {
      return `No files in workspace to search`;
    }

    if (!context.storage) {
      return `Content search for "${query}" (searching ${fileResults.length} files)\n` +
        `Note: Full content search requires vector indexing. ` +
        `Try file_read on specific files or use filename search.`;
    }

    const matches: { path: string; lineNum: number; line: string }[] = [];

    for (const file of fileResults.slice(0, 20)) {
      try {
        const r2Key = `spaces/${context.spaceId}/files/${file.id}`;
        const object = await context.storage.get(r2Key);

        if (!object) continue;

        const content = await object.text();
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(query.toLowerCase())) {
            matches.push({
              path: file.path,
              lineNum: i + 1,
              line: lines[i].trim().substring(0, 100),
            });

            if (matches.length >= 20) break;
          }
        }

        if (matches.length >= 20) break;
      } catch {
        // Skip files that can't be read
      }
    }

    if (matches.length === 0) {
      return `No matches found for "${query}" in ${fileResults.length} files`;
    }

    return `Found ${matches.length} matches for "${query}":\n\n` +
      matches.map(m => `${m.path}:${m.lineNum}\n  ${m.line}`).join('\n\n');
  }
};

export const ARTIFACT_TOOLS: ToolDefinition[] = [
  CREATE_ARTIFACT,
  SEARCH,
];

export const ARTIFACT_HANDLERS: Record<string, ToolHandler> = {
  create_artifact: createArtifactHandler,
  search: searchHandler,
};
