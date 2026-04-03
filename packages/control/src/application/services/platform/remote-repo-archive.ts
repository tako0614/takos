import { concatBytes } from "../git-smart/core/sha1.ts";
import { BadRequestError } from "takos-common/errors";

const DEFAULT_REMOTE_ARCHIVE_MAX_BYTES = 200 * 1024 * 1024;

function removeGitSuffix(pathname: string): string {
  return pathname.replace(/\/+$/, "").replace(/\.git$/i, "");
}

async function readResponseBytes(
  response: Response,
  maxBytes: number | null,
): Promise<ArrayBuffer> {
  if (maxBytes === null || !response.body) {
    return response.arrayBuffer();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new BadRequestError(
          `Remote repository archive exceeds size limit of ${maxBytes} bytes`,
        );
      }
      chunks.push(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      );
    }
  } finally {
    reader.releaseLock();
  }

  const concatenated = concatBytes(...chunks);
  const copy = new Uint8Array(concatenated.byteLength);
  copy.set(concatenated);
  return copy.buffer;
}

export function buildArchiveDownloadUrl(
  repositoryUrl: string,
  ref: string,
): string | null {
  const parsed = new URL(repositoryUrl);
  const repoPath = removeGitSuffix(parsed.pathname);
  const pathSegments = repoPath.split("/").filter(Boolean);
  if (pathSegments.length < 2) return null;

  if (parsed.hostname === "github.com") {
    const [owner, repo] = pathSegments;
    return `https://codeload.github.com/${encodeURIComponent(owner)}/${
      encodeURIComponent(repo)
    }/zip/${encodeURIComponent(ref)}`;
  }

  if (
    parsed.hostname === "gitlab.com" || parsed.hostname.endsWith(".gitlab.com")
  ) {
    const repoName = pathSegments[pathSegments.length - 1];
    return `${parsed.protocol}//${parsed.host}${repoPath}/-/archive/${
      encodeURIComponent(ref)
    }/${encodeURIComponent(repoName)}-${encodeURIComponent(ref)}.zip`;
  }

  return null;
}

export async function extractRepositoryZipFiles(
  archiveData: ArrayBuffer,
): Promise<Map<string, Uint8Array>> {
  const jszip = await import("jszip");
  const JSZip = "default" in jszip ? jszip.default : jszip;
  const zip = await JSZip.loadAsync(archiveData);
  const files = new Map<string, Uint8Array>();

  for (const entryName of Object.keys(zip.files)) {
    const entry = zip.file(entryName);
    if (!entry) continue;
    if (entry.dir) continue;
    const normalized = entryName.replace(/\\/g, "/").replace(/^\/+/, "");
    const slashIndex = normalized.indexOf("/");
    if (slashIndex === -1 || slashIndex === normalized.length - 1) continue;
    const relativePath = normalized.slice(slashIndex + 1);
    if (!relativePath || relativePath.includes("..")) continue;
    files.set(relativePath, await entry.async("uint8array"));
  }

  return files;
}

export async function fetchRepositoryArchive(
  repositoryUrl: string,
  ref: string,
  options?: { maxArchiveBytes?: number | null },
): Promise<Map<string, Uint8Array> | null> {
  const archiveUrl = buildArchiveDownloadUrl(repositoryUrl, ref);
  if (!archiveUrl) return null;

  const response = await fetch(archiveUrl, { redirect: "follow" });
  if (!response.ok) return null;

  const maxArchiveBytes = options?.maxArchiveBytes === null
    ? null
    : options?.maxArchiveBytes ?? DEFAULT_REMOTE_ARCHIVE_MAX_BYTES;
  const archiveData = await readResponseBytes(response, maxArchiveBytes);
  return extractRepositoryZipFiles(archiveData);
}
