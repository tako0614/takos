import { toSafeHref } from "../../lib/safeHref.ts";

export function getPackageIconImageSrc(
  icon: string | null | undefined,
): string | null {
  const safeIcon = toSafeHref(icon);
  if (!safeIcon || safeIcon.startsWith("//")) return null;
  if (safeIcon.startsWith("/") || /^https?:\/\//i.test(safeIcon)) {
    return safeIcon;
  }
  return null;
}
