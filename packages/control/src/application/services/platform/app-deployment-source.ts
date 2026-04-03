import { BadRequestError } from "takos-common/errors";

import type { Env } from "../../../shared/types/index.ts";

export type RepoRefType = "branch" | "tag" | "commit";

function getPlatformOrigin(env: Env): string {
  const raw = String(env.ADMIN_DOMAIN || "").trim();
  if (!raw) throw new BadRequestError("ADMIN_DOMAIN is not configured");
  const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(normalized);
  return `${parsed.protocol}//${parsed.host}`;
}

export function normalizeRepositoryUrl(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) {
    throw new BadRequestError("repository_url is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new BadRequestError("repository_url must be a valid URL");
  }

  if (parsed.protocol !== "https:") {
    throw new BadRequestError("repository_url must use https://");
  }
  if (parsed.username || parsed.password) {
    throw new BadRequestError(
      "repository_url must not include embedded credentials",
    );
  }
  if (parsed.search || parsed.hash) {
    throw new BadRequestError(
      "repository_url must not include query parameters or fragments",
    );
  }

  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.pathname = parsed.pathname
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "");

  if (!parsed.pathname || parsed.pathname === "/") {
    throw new BadRequestError(
      "repository_url must include an owner and repository path",
    );
  }
  if (!parsed.pathname.endsWith(".git")) {
    parsed.pathname = `${parsed.pathname}.git`;
  }

  return parsed.toString();
}

export function repositoryUrlKey(input: string): string {
  const normalized = normalizeRepositoryUrl(input);
  const parsed = new URL(normalized);
  const path = parsed.pathname.replace(/\/+$/, "").replace(/\.git$/i, "");
  return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}`;
}

export function buildTakosRepositoryUrl(
  env: Env,
  ownerSlug: string,
  repoName: string,
): string {
  return normalizeRepositoryUrl(
    `${getPlatformOrigin(env)}/git/${ownerSlug}/${repoName}.git`,
  );
}

export function parseTakosRepositoryUrl(
  env: Env,
  input: string,
): { ownerSlug: string; repoName: string } | null {
  const normalized = normalizeRepositoryUrl(input);
  const parsed = new URL(normalized);
  const platform = new URL(getPlatformOrigin(env));
  if (parsed.host.toLowerCase() !== platform.host.toLowerCase()) {
    return null;
  }
  const match = parsed.pathname.match(/^\/git\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match) return null;
  return {
    ownerSlug: decodeURIComponent(match[1]),
    repoName: decodeURIComponent(match[2].replace(/\.git$/i, "")),
  };
}

export function normalizeRepoPath(value: string): string {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/")
    .trim();
}

export function normalizeRepoRef(refType: RepoRefType, ref: string): string {
  const normalized = String(ref || "").trim();
  if (!normalized) {
    throw new BadRequestError("ref is required");
  }
  if (refType === "branch") {
    return normalized.replace(/^refs\/heads\//, "");
  }
  if (refType === "tag") {
    return normalized.replace(/^refs\/tags\//, "");
  }
  return normalized;
}

export function buildWorkflowRunRef(
  refType: RepoRefType,
  ref: string,
): string | null {
  if (refType === "branch") return `refs/heads/${ref}`;
  if (refType === "tag") return `refs/tags/${ref}`;
  return null;
}

export function isDirectoryMode(mode: string | undefined): boolean {
  return mode === "040000" || mode === "40000";
}

export function looksLikeInlineSql(value: string): boolean {
  const sql = value.trim();
  if (!sql) return false;
  if (/\n/.test(sql) && /;/.test(sql)) return true;
  return /^(--|\/\*|\s*(create|alter|drop|insert|update|delete|pragma|begin|commit|with)\b)/i
    .test(sql);
}
