export type ConnectionInputKind =
  | "empty"
  | "https_url"
  | "unsupported_url"
  | "domain"
  | "registry_id"
  | "search";

export interface ClassifiedConnectionInput {
  kind: ConnectionInputKind;
  value: string;
}

export interface DirectConnectionDisclosure {
  endpoint: string;
  hostname: string;
  suggestedName: string;
}

const REGISTRY_ID_PATTERN =
  /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?\/[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/i;
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
export const MCP_SERVER_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

function parseDirectHttpsUrl(value: string): URL | null {
  if (!/^https:\/\//i.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.port ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function classifyConnectionInput(
  rawValue: string,
): ClassifiedConnectionInput {
  const value = rawValue.trim();
  if (!value) return { kind: "empty", value };
  if (parseDirectHttpsUrl(value)) return { kind: "https_url", value };
  if (URL_SCHEME_PATTERN.test(value)) {
    return { kind: "unsupported_url", value };
  }
  if (DOMAIN_PATTERN.test(value)) return { kind: "domain", value };
  if (REGISTRY_ID_PATTERN.test(value)) {
    return { kind: "registry_id", value };
  }
  return { kind: "search", value };
}

export function deriveMcpServerName(hostname: string): string {
  const withoutWww = hostname.toLowerCase().replace(/^www\./, "");
  let name = withoutWww.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!name) name = "mcp-server";
  if (!/^[a-z]/i.test(name)) name = `mcp-${name}`;
  return name.slice(0, 64).replace(/[-_]+$/g, "") || "mcp-server";
}

export function describeDirectConnection(
  rawValue: string,
): DirectConnectionDisclosure | null {
  const parsed = parseDirectHttpsUrl(rawValue.trim());
  if (!parsed) return null;
  return {
    endpoint: parsed.toString(),
    hostname: parsed.hostname,
    suggestedName: deriveMcpServerName(parsed.hostname),
  };
}

export function isValidMcpServerName(value: string): boolean {
  return MCP_SERVER_NAME_PATTERN.test(value.trim());
}
