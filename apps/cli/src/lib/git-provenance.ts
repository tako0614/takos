import { execFile } from "node:child_process";
import path from "node:path";

type GitRefProjection = {
  kind: "git_ref";
  repository_url: string;
  ref: string;
  ref_type: "commit";
  commit_sha: string;
};

type LocalUploadProjection = {
  kind: "local_upload";
};

export type ApplySourceProjection = GitRefProjection | LocalUploadProjection;

function execGit(
  cwd: string,
  args: string[],
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const value = stdout.trim();
      resolve(value.length > 0 ? value : null);
    });
  });
}

function normalizeHttpsGitUrl(raw: string): string | null {
  const input = raw.trim();
  if (!input) return null;

  let httpsCandidate = input;
  const scpLike = input.match(/^git@([^:]+):(.+)$/i);
  if (scpLike) {
    httpsCandidate = `https://${scpLike[1]}/${scpLike[2]}`;
  } else if (/^ssh:\/\//i.test(input)) {
    try {
      const parsed = new URL(input);
      httpsCandidate = `https://${parsed.host}${parsed.pathname}`;
    } catch {
      return null;
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(httpsCandidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    return null;
  }

  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.pathname = parsed.pathname
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "");

  if (!parsed.pathname || parsed.pathname === "/") return null;
  if (!parsed.pathname.endsWith(".git")) {
    parsed.pathname = `${parsed.pathname}.git`;
  }

  return parsed.toString();
}

async function resolvePreferredRepositoryUrl(
  projectRoot: string,
): Promise<string | null> {
  const currentBranch = await execGit(projectRoot, [
    "branch",
    "--show-current",
  ]);
  if (currentBranch) {
    const upstreamRemote = await execGit(projectRoot, [
      "config",
      "--get",
      `branch.${currentBranch}.remote`,
    ]);
    if (upstreamRemote) {
      const upstreamUrl = await execGit(projectRoot, [
        "config",
        "--get",
        `remote.${upstreamRemote}.url`,
      ]);
      const normalizedUpstreamUrl = upstreamUrl
        ? normalizeHttpsGitUrl(upstreamUrl)
        : null;
      if (normalizedUpstreamUrl) {
        return normalizedUpstreamUrl;
      }
    }
  }

  const originUrl = await execGit(projectRoot, [
    "config",
    "--get",
    "remote.origin.url",
  ]);
  const normalizedOriginUrl = originUrl
    ? normalizeHttpsGitUrl(originUrl)
    : null;
  if (normalizedOriginUrl) {
    return normalizedOriginUrl;
  }

  const remotes = await execGit(projectRoot, ["remote"]);
  const remoteNames = remotes
    ? remotes.split("\n").map((value) => value.trim()).filter(Boolean)
    : [];
  if (remoteNames.length === 1) {
    const remoteUrl = await execGit(projectRoot, [
      "config",
      "--get",
      `remote.${remoteNames[0]}.url`,
    ]);
    return remoteUrl ? normalizeHttpsGitUrl(remoteUrl) : null;
  }

  return null;
}

export async function inferApplySourceProjection(
  manifestPath: string,
): Promise<ApplySourceProjection> {
  const projectRoot = path.dirname(path.dirname(manifestPath));
  const repositoryUrl = await resolvePreferredRepositoryUrl(projectRoot);
  const commitSha = await execGit(projectRoot, ["rev-parse", "HEAD"]);

  if (!repositoryUrl || !commitSha) {
    return { kind: "local_upload" };
  }

  return {
    kind: "git_ref",
    repository_url: repositoryUrl,
    ref: commitSha,
    ref_type: "commit",
    commit_sha: commitSha,
  };
}
