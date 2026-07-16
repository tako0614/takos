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

export type CatalogInstallationProjection = {
  groupId: string | null;
  groupName: string | null;
  version: string | null;
  commitSha: string | null;
  deployedAt: string | null;
  installationId?: string | null;
  appId?: string | null;
  status?: string | null;
  runtimeMode?: string | null;
  installedAt?: string | null;
  updatedAt?: string | null;
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

export function toCatalogInstallationProjection(
  capsule: CatalogCapsuleRecord,
): CatalogInstallationProjection {
  return {
    groupId: null,
    groupName: null,
    version: capsule.sourceRef,
    commitSha: capsule.sourceCommit,
    deployedAt: null,
    installationId: capsule.capsuleId,
    appId: capsule.appId,
    status: capsule.status,
    runtimeMode: capsule.runtimeMode,
    installedAt: capsule.createdAt,
    updatedAt: capsule.updatedAt,
    ...(capsule.services.length > 0 ? { services: capsule.services } : {}),
  };
}

export function mapCatalogInstallationResponse(
  installation: CatalogInstallationProjection | undefined,
) {
  if (!installation) {
    return {
      installed: false,
      group_id: null,
      group_name: null,
      installed_version: null,
      installed_commit: null,
      deployed_at: null,
    };
  }
  return {
    installed: true,
    ...(installation.installationId !== undefined
      ? { installation_id: installation.installationId }
      : {}),
    ...(installation.appId !== undefined ? { app_id: installation.appId } : {}),
    ...(installation.status !== undefined
      ? { status: installation.status }
      : {}),
    ...(installation.runtimeMode !== undefined
      ? { runtime_mode: installation.runtimeMode }
      : {}),
    group_id: installation.groupId,
    group_name: installation.groupName,
    installed_version: installation.version,
    installed_commit: installation.commitSha,
    deployed_at: installation.deployedAt,
    ...(installation.installedAt !== undefined
      ? { installed_at: installation.installedAt }
      : {}),
    ...(installation.updatedAt !== undefined
      ? { updated_at: installation.updatedAt }
      : {}),
    ...(installation.services !== undefined
      ? { services: installation.services }
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
  installation: CatalogInstallationProjection | undefined,
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
  if (installation) {
    item.installation = mapCatalogInstallationResponse(installation);
  }
  return item;
}
