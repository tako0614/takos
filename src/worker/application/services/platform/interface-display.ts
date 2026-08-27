/**
 * Takos-owned parser for Interface `document.display` metadata.
 *
 * Interface documents remain opaque to the host. This consumer-side module
 * owns the presentation sanitization needed by launcher, file-handler, and
 * MCP surfaces, including credential-query and same-viewer-origin guards.
 */

export const INTERFACE_DISPLAY_TITLE_MAX_LENGTH = 256;
export const INTERFACE_DISPLAY_DESCRIPTION_MAX_LENGTH = 1_024;
export const INTERFACE_DISPLAY_CATEGORY_MAX_LENGTH = 64;
export const INTERFACE_DISPLAY_ICON_MAX_LENGTH = 2_048;
export const INTERFACE_DISPLAY_GLYPH_MAX_LENGTH = 16;

export type InterfaceDisplayIcon =
  | { readonly kind: "image"; readonly url: string }
  | { readonly kind: "glyph"; readonly glyph: string };

export interface InterfaceDisplay {
  readonly title?: string;
  readonly description?: string;
  readonly icon?: InterfaceDisplayIcon;
  readonly category?: string;
  readonly sortOrder?: number;
}

/**
 * Parse a `document.display` value. Unknown fields are ignored; every field
 * is optional and invalid values degrade to absence, never to an error.
 */
export function parseInterfaceDisplay(
  value: unknown,
  options: {
    readonly surfaceUrl?: string;
    readonly viewerOrigin?: string;
  } = {},
): InterfaceDisplay {
  const record = isRecord(value) ? value : null;
  if (!record) return {};
  const title = boundedText(record.title, INTERFACE_DISPLAY_TITLE_MAX_LENGTH);
  const description = boundedText(
    record.description,
    INTERFACE_DISPLAY_DESCRIPTION_MAX_LENGTH,
  );
  const icon = resolveDisplayIcon(
    record.icon,
    options.surfaceUrl,
    options.viewerOrigin,
  );
  const category = boundedText(
    record.category,
    INTERFACE_DISPLAY_CATEGORY_MAX_LENGTH,
  );
  const sortOrder =
    typeof record.sortOrder === "number" && Number.isFinite(record.sortOrder)
      ? record.sortOrder
      : undefined;
  return {
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(icon ? { icon } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(sortOrder !== undefined ? { sortOrder } : {}),
  };
}

/**
 * Resolve a `display.icon` value to a credential-free HTTPS image URL, a
 * leading-`/` path resolved against the surface's runtime origin, or a short
 * textual glyph. Everything else resolves to `null`.
 *
 * `viewerOrigin` is the origin of the page that renders the icon. A same-origin
 * icon could trigger a session-credentialed navigation the viewer never
 * approved, so it is rejected before it reaches the UI.
 */
export function resolveDisplayIcon(
  value: unknown,
  surfaceUrl?: string,
  viewerOrigin?: string,
): InterfaceDisplayIcon | null {
  const raw = boundedText(value, INTERFACE_DISPLAY_ICON_MAX_LENGTH);
  if (raw === undefined) return null;

  // A short token with no path/scheme punctuation is a textual glyph.
  if (![...raw].some((char) => "/.:".includes(char))) {
    return [...raw].length <= INTERFACE_DISPLAY_GLYPH_MAX_LENGTH
      ? { kind: "glyph", glyph: raw }
      : null;
  }

  if (raw.startsWith("/") && !raw.startsWith("//")) {
    if (surfaceUrl === undefined) return null;
    let origin: string;
    try {
      const base = new URL(surfaceUrl);
      if (base.protocol !== "http:" && base.protocol !== "https:") return null;
      origin = `${base.protocol}//${base.host}`;
    } catch {
      return null;
    }
    return safeImageUrl(raw, origin, { allowHttp: true, viewerOrigin });
  }

  return safeImageUrl(raw, undefined, { allowHttp: false, viewerOrigin });
}

function safeImageUrl(
  raw: string,
  base: string | undefined,
  options: {
    readonly allowHttp: boolean;
    readonly viewerOrigin?: string;
  },
): InterfaceDisplayIcon | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  const allowedProtocols = options.allowHttp ? ["https:", "http:"] : ["https:"];
  if (!allowedProtocols.includes(url.protocol)) return null;
  if (url.username || url.password || url.hash) return null;
  if (hasCredentialQueryParams(url.searchParams)) return null;
  if (
    options.viewerOrigin &&
    url.origin === normalizedOrigin(options.viewerOrigin)
  ) {
    return null;
  }
  return { kind: "image", url: url.toString() };
}

function normalizedOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}

const CREDENTIAL_QUERY_NAMES = new Set([
  "accesskey",
  "accesstoken",
  "apikey",
  "auth",
  "authorization",
  "bearertoken",
  "clientsecret",
  "cookie",
  "credential",
  "credentials",
  "credentialvalue",
  "jwt",
  "passwd",
  "password",
  "privatekey",
  "proxyauthorization",
  "refreshtoken",
  "secret",
  "session",
  "sessionid",
  "sessiontoken",
  "sig",
  "signature",
  "signingkey",
  "token",
  "xamzcredential",
  "xamzsecuritytoken",
  "xamzsignature",
  "xgoogcredential",
  "xgoogsignature",
  "xapikey",
]);

/** True when a query string carries a credential-named parameter. */
export function hasCredentialQueryParams(parameters: URLSearchParams): boolean {
  for (const [name, value] of parameters) {
    const normalizedName = name.toLowerCase().replace(/[^a-z0-9]/gu, "");
    if (value.trim() && CREDENTIAL_QUERY_NAMES.has(normalizedName)) return true;
  }
  return false;
}
