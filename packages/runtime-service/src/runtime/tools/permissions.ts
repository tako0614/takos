export type FilePermission = "read" | "write" | "none";

const FILE_PERMISSIONS = new Set<FilePermission>(["read", "write", "none"]);

export function parseFilePermission(value: unknown): FilePermission {
  if (
    typeof value === "string" && FILE_PERMISSIONS.has(value as FilePermission)
  ) {
    return value as FilePermission;
  }
  return "none";
}
