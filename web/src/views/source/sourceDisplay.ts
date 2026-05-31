import type {
  SourceItem,
  SourceItemInstallation,
} from "../../hooks/useSourceData.ts";
import { getInstallSource } from "../../hooks/sourceInstall.ts";

type GitRefSource = NonNullable<SourceItem["source"]>;

export function getDisplaySource(item: SourceItem): GitRefSource | null {
  if (item.source?.kind === "git_ref") return item.source;
  if (item.package?.available) return getInstallSource(item);
  return null;
}

export function shortCommit(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.length > 12 ? trimmed.slice(0, 12) : trimmed;
}

export function formatRepositorySourceLabel(repositoryUrl: string): string {
  try {
    const parsed = new URL(repositoryUrl);
    const segments = parsed.pathname
      .replace(/\/+$/, "")
      .replace(/\.git$/i, "")
      .split("/")
      .filter(Boolean);
    if (segments.length >= 2) {
      const owner = decodeURIComponent(segments[segments.length - 2]);
      const repo = decodeURIComponent(segments[segments.length - 1]);
      return `${owner}/${repo}`;
    }
    return parsed.host;
  } catch {
    return repositoryUrl.replace(/\/+$/, "").replace(/\.git$/i, "");
  }
}

export function formatTrackingRef(source: GitRefSource): string {
  const ref = source.ref_type === "commit"
    ? shortCommit(source.ref) ?? source.ref
    : source.ref;
  return `${source.ref_type} ${ref}`;
}

export function formatTrackingRefLabel(
  source: GitRefSource,
  labels: {
    branch: string;
    tag: string;
    commit: string;
  },
): string {
  const ref = source.ref_type === "commit"
    ? shortCommit(source.ref) ?? source.ref
    : source.ref;
  return `${labels[source.ref_type]} ${ref}`;
}

export function formatInstalledValue(
  installation: SourceItemInstallation | undefined,
): { kind: "version" | "commit"; value: string } | null {
  if (!installation?.installed) return null;
  const version = installation.installed_version?.trim();
  if (version) return { kind: "version", value: version };
  const commit = shortCommit(installation.installed_commit);
  if (commit) return { kind: "commit", value: commit };
  return null;
}
