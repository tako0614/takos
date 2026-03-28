import type { ToolDefinition, ToolHandler } from '../tool-definitions';
import { checkRepoAccess } from '../../services/source/repos';
import { listCatalogItems } from '../../services/source/explore';
import { forkWithWorkflows } from '../../services/source/fork';

const STORE_SORT_OPTIONS = ['trending', 'new', 'stars', 'updated', 'downloads'] as const;
const STORE_TYPE_OPTIONS = ['all', 'repo', 'deployable-app'] as const;

export const STORE_SEARCH: ToolDefinition = {
  name: 'store_search',
  description: 'Search the Takos store/catalog for public repositories and deployable apps.',
  category: 'workspace',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query. Leave empty to browse the current sort order.',
      },
      type: {
        type: 'string',
        description: 'Catalog item type filter.',
        enum: [...STORE_TYPE_OPTIONS],
      },
      sort: {
        type: 'string',
        description: 'Sort order for results.',
        enum: [...STORE_SORT_OPTIONS],
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 10, max: 20).',
      },
      category: {
        type: 'string',
        description: 'Optional category filter.',
      },
      language: {
        type: 'string',
        description: 'Optional language filter.',
      },
      license: {
        type: 'string',
        description: 'Optional license filter.',
      },
      since: {
        type: 'string',
        description: 'Optional date filter in YYYY-MM-DD format.',
      },
      tags: {
        type: 'string',
        description: 'Optional comma-separated tag filter.',
      },
      certified_only: {
        type: 'boolean',
        description: 'Only return certified deployable apps.',
      },
    },
    required: [],
  },
};

export const REPO_FORK: ToolDefinition = {
  name: 'repo_fork',
  description: 'Fork a Takos repository into the current workspace so it becomes an owned code asset.',
  category: 'workspace',
  parameters: {
    type: 'object',
    properties: {
      repo_id: {
        type: 'string',
        description: 'Source repository ID to fork.',
      },
      name: {
        type: 'string',
        description: 'Optional name for the fork in the current workspace.',
      },
    },
    required: ['repo_id'],
  },
};

function clampLimit(value: unknown, fallback: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(numeric), max);
}

function normalizeEnumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T[number]) : fallback;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

export const storeSearchHandler: ToolHandler = async (args, context) => {
  const sort = normalizeEnumValue(args.sort, STORE_SORT_OPTIONS, 'trending');
  const type = normalizeEnumValue(args.type, STORE_TYPE_OPTIONS, 'all');
  const limit = clampLimit(args.limit, 10, 20);
  const query = normalizeOptionalString(args.query);
  const tagsRaw = normalizeOptionalString(args.tags);

  const result = await listCatalogItems(context.db, {
    sort,
    limit,
    offset: 0,
    searchQuery: query,
    type,
    category: normalizeOptionalString(args.category),
    language: normalizeOptionalString(args.language),
    license: normalizeOptionalString(args.license),
    since: normalizeOptionalString(args.since),
    tagsRaw,
    certifiedOnly: args.certified_only === true,
    spaceId: context.spaceId,
    userId: context.userId,
  });

  const items = result.items.map((item) => ({
    repo_id: item.repo.id,
    repo_name: item.repo.name,
    owner_username: item.repo.owner.username,
    description: item.repo.description,
    stars: item.repo.stars,
    forks: item.repo.forks,
    language: item.repo.language,
    license: item.repo.license,
    takopack_available: item.takopack.available,
    takopack_app_id: item.takopack.app_id,
    takopack_version: item.takopack.latest_version,
    takopack_category: item.takopack.category,
    takopack_tags: item.takopack.tags,
    takopack_publish_status: item.takopack.publish_status,
    installed_in_current_space: item.installation?.installed ?? false,
    installation_bundle_deployment_id: item.installation?.bundle_deployment_id ?? null,
  }));

  return JSON.stringify({
    sort,
    type,
    total: result.total,
    has_more: result.has_more,
    items,
  }, null, 2);
};

export const repoForkHandler: ToolHandler = async (args, context) => {
  const repoId = normalizeOptionalString(args.repo_id);
  if (!repoId) {
    throw new Error('repo_id is required');
  }

  const access = await checkRepoAccess(context.env, repoId, context.userId, undefined, {
    allowPublicRead: true,
  });

  if (!access) {
    throw new Error(`Repository not found or inaccessible: ${repoId}`);
  }

  const result = await forkWithWorkflows(context.db, context.env.GIT_OBJECTS, repoId, context.spaceId, {
    name: normalizeOptionalString(args.name),
  });

  return JSON.stringify({
    success: true,
    repository: result.repository,
    forked_from: result.forked_from,
  }, null, 2);
};

export const WORKSPACE_SOURCE_TOOLS: ToolDefinition[] = [
  STORE_SEARCH,
  REPO_FORK,
];

export const WORKSPACE_SOURCE_HANDLERS: Record<string, ToolHandler> = {
  store_search: storeSearchHandler,
  repo_fork: repoForkHandler,
};
