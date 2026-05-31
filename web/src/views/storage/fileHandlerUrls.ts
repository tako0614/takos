import type { StorageFile } from "../../types/index.ts";

type FileHandlerOpenTarget = {
  open_url: string;
};

export function fileHandlerOpenUrlHasIdPathTemplate(openUrl: string): boolean {
  try {
    const url = new URL(openUrl, "https://takos.invalid");
    return url.pathname.split("/").some((segment) => segment === ":id");
  } catch {
    return false;
  }
}

function appendQueryParam(url: string, key: string, value: string): string {
  const hashIndex = url.indexOf("#");
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}${encodeURIComponent(key)}=${
    encodeURIComponent(value)
  }${hash}`;
}

export function buildFileHandlerLaunchUrl(
  handler: FileHandlerOpenTarget,
  file: Pick<StorageFile, "id" | "space_id">,
  spaceId: string,
): string {
  if (!fileHandlerOpenUrlHasIdPathTemplate(handler.open_url)) {
    throw new Error("FileHandler open_url must include :id in the path");
  }
  const encodedFileId = encodeURIComponent(file.id);
  let url = handler.open_url.replaceAll(":id", encodedFileId);
  url = appendQueryParam(url, "space_id", file.space_id || spaceId);
  return url;
}
