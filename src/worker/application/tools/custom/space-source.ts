import { listCatalogItems } from "../../services/source/explore.ts";
import type { ToolDefinition, ToolHandler } from "../tool-definitions.ts";
import { defineTools } from "./define-tools.ts";

const STORE_SORT_OPTIONS = [
  "trending",
  "new",
  "stars",
  "updated",
  "downloads",
] as const;
const STORE_TYPE_OPTIONS = ["all", "repo", "deployable-app"] as const;

export const STORE_SEARCH: ToolDefinition = {
  name: "store_search",
  description:
    "Search the Takos catalog for public Git sources and installable OpenTofu Capsules. This is discovery-only and never installs, forks, or deploys a result.",
  category: "space",
  namespace: "catalog",
  family: "catalog.search",
  risk_level: "none",
  side_effects: false,
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query; omit to browse the selected sort order",
      },
      type: {
        type: "string",
        description: "Catalog item type filter",
        enum: [...STORE_TYPE_OPTIONS],
      },
      sort: {
        type: "string",
        description: "Sort order",
        enum: [...STORE_SORT_OPTIONS],
      },
      limit: {
        type: "number",
        description: "Maximum results (default: 10, max: 20)",
      },
      category: { type: "string", description: "Optional category filter" },
      language: { type: "string", description: "Optional language filter" },
      license: { type: "string", description: "Optional license filter" },
      since: {
        type: "string",
        description: "Optional updated-since filter in YYYY-MM-DD format",
      },
      tags: {
        type: "string",
        description: "Optional comma-separated tag filter",
      },
      certified_only: {
        type: "boolean",
        description: "Only return certified Capsules",
      },
    },
  },
};

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

function enumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return allowed.includes(normalized as T[number])
    ? normalized as T[number]
    : fallback;
}

export const storeSearchHandler: ToolHandler = async (args, context) => {
  const limitValue = Number(args.limit);
  const limit = Number.isFinite(limitValue) && limitValue > 0
    ? Math.min(Math.floor(limitValue), 20)
    : 10;
  const result = await listCatalogItems(context.db, {
    sort: enumValue(args.sort, STORE_SORT_OPTIONS, "trending"),
    limit,
    offset: 0,
    searchQuery: optionalString(args.query),
    type: enumValue(args.type, STORE_TYPE_OPTIONS, "all"),
    category: optionalString(args.category),
    language: optionalString(args.language),
    license: optionalString(args.license),
    since: optionalString(args.since),
    tagsRaw: optionalString(args.tags),
    certifiedOnly: args.certified_only === true,
    spaceId: context.spaceId,
    userId: context.userId,
    gitObjects: context.env.GIT_OBJECTS,
    repositoryBaseUrl: context.env.ADMIN_DOMAIN,
  });

  return JSON.stringify({
    total: result.total,
    has_more: result.has_more,
    items: result.items.map((item) => ({
      repo_id: item.repo.id,
      repo_name: item.repo.name,
      owner: item.repo.owner.username,
      description: item.repo.description,
      stars: item.repo.stars,
      language: item.repo.language,
      license: item.repo.license,
      capsule: item.package.available
        ? {
          app_id: item.package.app_id,
          version: item.package.latest_version,
          category: item.package.category,
          tags: item.package.tags,
          certified: item.package.certified,
        }
        : null,
      git_address: item.source
        ? {
          url: item.source.repository_url,
          ref: item.source.ref,
          path: item.installable_app?.source_path ?? "",
        }
        : null,
      installed_in_current_workspace: item.installation?.installed ?? false,
    })),
  }, null, 2);
};

export const {
  tools: WORKSPACE_SOURCE_TOOLS,
  handlers: WORKSPACE_SOURCE_HANDLERS,
} = defineTools([[STORE_SEARCH, storeSearchHandler]]);
