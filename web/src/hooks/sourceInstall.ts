import type { SourceItem, SourceItemInstallation } from "./useSourceData.ts";

export type SourceInstallSource = NonNullable<SourceItem["source"]>;

const DEFAULT_INSTALL_ENV = "staging";

function platformOrigin(): string {
  return globalThis.location?.origin ?? "";
}

function normalizeRepositoryUrlKey(repositoryUrl: string): string {
  try {
    const parsed = new URL(repositoryUrl);
    parsed.pathname = parsed.pathname.replace(/\/+$/, "").replace(
      /\.git$/i,
      "",
    );
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/+$/, "").toLowerCase();
  } catch {
    return repositoryUrl.trim().replace(/\/+$/, "").replace(/\.git$/i, "")
      .toLowerCase();
  }
}

export function sourceInstallationKey(
  source: {
    repository_url?: string | null;
    ref?: string | null;
    ref_type?: "branch" | "tag" | "commit" | null;
  },
): string | null {
  if (!source.repository_url || !source.ref || !source.ref_type) {
    return null;
  }
  return `${
    normalizeRepositoryUrlKey(source.repository_url)
  }#${source.ref_type}:${source.ref}`;
}

export function getInstallSource(item: SourceItem): SourceInstallSource {
  if (item.source?.kind === "git_ref") {
    return item.source;
  }

  const releaseTag = item.package?.release_tag || item.package?.latest_tag;
  if (releaseTag) {
    return {
      kind: "git_ref",
      repository_url:
        `${platformOrigin()}/git/${item.owner.username}/${item.name}.git`,
      ref: releaseTag,
      ref_type: "tag",
      env: DEFAULT_INSTALL_ENV,
    };
  }

  return {
    kind: "git_ref",
    repository_url:
      `${platformOrigin()}/git/${item.owner.username}/${item.name}.git`,
    ref: item.default_branch || "main",
    ref_type: "branch",
    env: DEFAULT_INSTALL_ENV,
  };
}

export function getInstallEnv(item: SourceItem): string {
  return item.source?.env ?? DEFAULT_INSTALL_ENV;
}

export function lookupInstallation(
  installMap: Map<string, SourceItemInstallation>,
  item: SourceItem,
  fallback?: SourceItemInstallation,
): SourceItemInstallation | undefined {
  const byId = installMap.get(item.id);
  if (byId) return byId;

  const key = sourceInstallationKey(getInstallSource(item));
  return key ? installMap.get(key) ?? fallback : fallback;
}
