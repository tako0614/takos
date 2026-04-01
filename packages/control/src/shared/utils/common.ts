export function buildDurableObjectUrl(pathname: string): string {
  const normalizedPath = pathname.startsWith("/")
    ? pathname
    : pathname.length === 0
    ? "/"
    : `/${pathname}`;
  return `https://internal.do${normalizedPath}`;
}

export function extractBearerToken(
  header: string | null | undefined,
): string | null {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}
