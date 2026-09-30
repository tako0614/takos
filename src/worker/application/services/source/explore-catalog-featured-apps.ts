import type {
  CatalogDeploySourceResponse,
  CatalogInstallableAppResponse,
  CatalogItemResponse,
  CatalogType,
  ParsedCatalogTags,
} from "./explore-types.ts";
import type { FeaturedAppCatalogEntry } from "./featured-app-catalog.ts";
import type { CatalogCapsuleRecord } from "./explore-catalog-accounts.ts";
import type { CapsuleWorkloadServiceSummary } from "./takosumi-workload-services.ts";
import type { CapsuleWireStatus } from "../../../../contracts/external/takosumi-capsule-status.ts";

export type CatalogCapsuleProjection = {
  capsuleId: string;
  appId: string;
  status: CapsuleWireStatus;
  environment: string | null;
  sourceRef: string | null;
  sourceCommit: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  services?: CapsuleWorkloadServiceSummary[];
};

export function normalizeCatalogRepositoryUrlKey(
  repositoryUrl: string,
): string {
  const trimmed = repositoryUrl.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    parsed.search = "";
    parsed.username = "";
    parsed.password = "";
    const path = parsed.pathname.replace(/\/+$/, "").replace(/\.git$/i, "");
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}`;
  } catch {
    return trimmed
      .replace(/\/+$/, "")
      .replace(/\.git$/i, "")
      .toLowerCase();
  }
}

function featuredAppCatalogId(name: string): string {
  return `featured-app:${name}`;
}

export function featuredAppPackageAppId(
  entry: FeaturedAppCatalogEntry,
): string {
  return entry.appId ?? entry.name;
}

export function featuredAppSourceKey(input: {
  repositoryUrl: string;
  ref: string;
  refType: string;
}): string {
  return `${normalizeCatalogRepositoryUrlKey(
    input.repositoryUrl,
  )}#${input.refType}:${input.ref}`;
}

export function canonicalSourceKeys(capsule: CatalogCapsuleRecord): string[] {
  const { sourceUrl, sourceRef } = capsule;
  if (!sourceUrl || !sourceRef) return [];
  return (["branch", "tag", "commit"] as const).map((refType) =>
    featuredAppSourceKey({
      repositoryUrl: sourceUrl,
      ref: sourceRef,
      refType,
    }),
  );
}

export function toCatalogCapsuleProjection(
  capsule: CatalogCapsuleRecord,
): CatalogCapsuleProjection {
  return {
    capsuleId: capsule.capsuleId,
    appId: capsule.appId,
    status: capsule.status,
    environment: capsule.environment,
    sourceRef: capsule.sourceRef,
    sourceCommit: capsule.sourceCommit,
    createdAt: capsule.createdAt,
    updatedAt: capsule.updatedAt,
    ...(capsule.services.length > 0 ? { services: capsule.services } : {}),
  };
}

export function mapCatalogCapsuleResponse(
  capsule: CatalogCapsuleProjection,
) {
  return {
    capsule_id: capsule.capsuleId,
    app_id: capsule.appId,
    status: capsule.status,
    environment: capsule.environment,
    source_ref: capsule.sourceRef,
    source_commit: capsule.sourceCommit,
    created_at: capsule.createdAt,
    updated_at: capsule.updatedAt,
    ...(capsule.services !== undefined
      ? { services: capsule.services }
      : {}),
  };
}

function featuredAppTags(entry: FeaturedAppCatalogEntry): string[] {
  return Array.from(
    new Set(
      [
        "default",
        "featured-app",
        "takos",
        entry.name,
        featuredAppPackageAppId(entry),
        ...(entry.tags ?? []),
        ...entry.name.split(/[-_\s]+/g),
      ]
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag && /^[a-z0-9][a-z0-9_-]*$/.test(tag)),
    ),
  ).slice(0, 10);
}

function featuredAppDescription(entry: FeaturedAppCatalogEntry): string {
  if (entry.description?.trim()) return entry.description.trim();
  return `Official Takos featured app deployed from ${entry.repositoryUrl}`;
}

function matchesFeaturedAppSearch(
  entry: FeaturedAppCatalogEntry,
  tags: string[],
  searchQuery: string | undefined,
): boolean {
  const query = searchQuery?.trim().toLowerCase();
  if (!query) return true;
  return [
    entry.name,
    featuredAppPackageAppId(entry),
    entry.title,
    entry.repositoryUrl,
    featuredAppDescription(entry),
    ...tags,
  ].some((value) => value.toLowerCase().includes(query));
}

export function shouldIncludeFeaturedAppEntry(
  entry: FeaturedAppCatalogEntry,
  options: {
    searchQuery?: string;
    type?: CatalogType;
    category?: string;
    certifiedOnly?: boolean;
  },
  parsedTags: ParsedCatalogTags,
): boolean {
  const tags = featuredAppTags(entry);
  if (!matchesFeaturedAppSearch(entry, tags, options.searchQuery)) return false;
  if (options.type === "repo") return true;
  if (options.category && options.category !== (entry.category ?? "app")) {
    return false;
  }
  if (parsedTags.tags.length > 0) {
    return parsedTags.tags.every((tag) => tags.includes(tag));
  }
  if (options.certifiedOnly === true) return true;
  return true;
}

function mapFeaturedAppInstallableApp(
  entry: FeaturedAppCatalogEntry,
): CatalogInstallableAppResponse | undefined {
  if (!entry.appId) return undefined;
  return {
    app_id: entry.appId,
    name: entry.title || entry.name,
    description: entry.description ?? null,
    publisher: entry.publisher ?? null,
    homepage: entry.homepage ?? null,
    source_path: entry.sourcePath ?? null,
    runtime_modes: entry.runtimeModes ? [...entry.runtimeModes] : [],
    bindings: entry.bindings
      ? entry.bindings.map((binding) => ({ ...binding }))
      : [],
  };
}

export function mapFeaturedAppCatalogItem(
  entry: FeaturedAppCatalogEntry,
  capsule: CatalogCapsuleProjection | undefined,
  timestamp: string,
): CatalogItemResponse {
  const tags = featuredAppTags(entry);
  const description = featuredAppDescription(entry);
  const source: CatalogDeploySourceResponse = {
    kind: "git_ref",
    repository_url: entry.repositoryUrl,
    ref: entry.ref,
    ref_type: entry.refType,
    backend: entry.backendName ?? null,
    env: entry.envName ?? null,
  };
  const item: CatalogItemResponse = {
    repo: {
      id: featuredAppCatalogId(entry.name),
      name: entry.title || entry.name,
      description,
      visibility: "public",
      default_branch: entry.refType === "branch" ? entry.ref : "main",
      stars: 0,
      forks: 0,
      category: "app",
      language: "TypeScript",
      license: null,
      is_starred: false,
      created_at: timestamp,
      updated_at: timestamp,
      space: {
        id: "takos-featured-apps",
        name: "Takos Featured Apps",
      },
      owner: {
        id: "takos",
        name: "Takos",
        username: "takos",
        avatar_url: null,
      },
      catalog_origin: "featured_app",
    },
    package: {
      available: true,
      app_id: featuredAppPackageAppId(entry),
      latest_version: entry.refType === "tag" ? entry.ref : null,
      latest_tag: entry.refType === "tag" ? entry.ref : null,
      release_id: null,
      release_tag: entry.refType === "tag" ? entry.ref : null,
      asset_id: null,
      description,
      icon: entry.icon ?? null,
      category: entry.category ?? "app",
      tags,
      downloads: 0,
      rating_avg: null,
      rating_count: 0,
      publish_status: "approved",
      certified: true,
      published_at: timestamp,
    },
    source,
  };
  const installableApp = mapFeaturedAppInstallableApp(entry);
  if (installableApp) {
    item.installable_app = installableApp;
  }
  if (capsule) {
    item.capsule = mapCatalogCapsuleResponse(capsule);
  }
  return item;
}
