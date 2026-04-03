export type AppUrlResolution =
  | { kind: "route"; path: string; search: string }
  | { kind: "redirect"; href: string }
  | { kind: "fallback" };

export function resolveAppUrl(
  appUrl: string,
  currentOrigin: string,
): AppUrlResolution {
  const normalized = appUrl.trim();

  if (!normalized) {
    return { kind: "fallback" };
  }

  if (normalized.startsWith("/")) {
    try {
      const parsed = new URL(normalized, currentOrigin);
      if (parsed.origin !== currentOrigin) {
        return { kind: "fallback" };
      }
      return { kind: "route", path: parsed.pathname, search: parsed.search };
    } catch {
      return { kind: "fallback" };
    }
  }

  if (!/^https?:\/\//i.test(normalized)) {
    return { kind: "fallback" };
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.origin !== currentOrigin) {
      return { kind: "fallback" };
    }
    return { kind: "redirect", href: parsed.toString() };
  } catch {
    return { kind: "fallback" };
  }
}
