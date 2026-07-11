import { type Accessor, createEffect, createSignal, on } from "solid-js";
import { createLatestRequest } from "../lib/createLatestRequest.ts";
import { getErrorMessage } from "../lib/errors.ts";
import { useI18n } from "../store/i18n.ts";
import type {
  McpRegistrySearchResult,
  McpRegistryAuthType,
  McpRegistrySource,
  McpRegistrySourceKind,
  McpServerCardDiscoveryResult,
} from "../types/index.ts";

interface UseMcpRegistryOptions {
  spaceId: Accessor<string>;
}

export interface McpRegistrySourceInput {
  name: string;
  base_url: string;
  source_kind: Exclude<McpRegistrySourceKind, "official">;
  enabled?: boolean;
  priority: number;
  auth_type: McpRegistryAuthType;
  auth_header_name?: string | null;
  auth_secret?: string;
}

export type McpRegistrySourcePatch = Partial<McpRegistrySourceInput>;

interface ApiEnvelope<T> {
  data: T;
  error?: unknown;
}

async function parseApiResponse<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as Partial<
    ApiEnvelope<T>
  >;
  if (!response.ok || body.data === undefined) {
    throw new Error(getErrorMessage(body.error, fallbackMessage));
  }
  return body.data;
}

async function ensureApiSuccess(
  response: Response,
  fallbackMessage: string,
): Promise<void> {
  if (response.ok) return;
  const body = (await response.json().catch(() => ({}))) as {
    error?: unknown;
  };
  throw new Error(getErrorMessage(body.error, fallbackMessage));
}

export function useMcpRegistry({ spaceId }: UseMcpRegistryOptions) {
  const { t } = useI18n();
  const currentSpaceId = () => spaceId().trim();
  const [sources, setSources] = createSignal<McpRegistrySource[]>([]);
  const [sourcesLoading, setSourcesLoading] = createSignal(true);
  const [sourcesError, setSourcesError] = createSignal<string | null>(null);
  const [searchResult, setSearchResult] =
    createSignal<McpRegistrySearchResult | null>(null);
  const [searchLoading, setSearchLoading] = createSignal(false);
  const [searchError, setSearchError] = createSignal<string | null>(null);
  const latestSources = createLatestRequest();
  const latestSearch = createLatestRequest();

  const clearSearch = () => {
    latestSearch.next();
    setSearchResult(null);
    setSearchError(null);
    setSearchLoading(false);
  };

  const queryPath = (pathname: string, targetSpaceId = currentSpaceId()) =>
    `${pathname}?workspaceId=${encodeURIComponent(targetSpaceId)}`;

  const refreshSources = async () => {
    const targetSpaceId = currentSpaceId();
    if (!targetSpaceId) {
      latestSources.next();
      setSources([]);
      setSourcesError(null);
      setSourcesLoading(false);
      return;
    }
    const claim = latestSources.claim(() => targetSpaceId === currentSpaceId());
    setSourcesLoading(true);
    setSourcesError(null);
    try {
      const response = await fetch(
        queryPath("/api/mcp/registry-sources", targetSpaceId),
      );
      const nextSources = await parseApiResponse<McpRegistrySource[]>(
        response,
        t("registrySourcesFetchFailed"),
      );
      if (!claim.won()) return;
      setSources(nextSources);
    } catch (cause) {
      if (!claim.won()) return;
      setSources([]);
      setSourcesError(
        cause instanceof Error && cause.message
          ? cause.message
          : t("registrySourcesFetchFailed"),
      );
    } finally {
      if (claim.won()) setSourcesLoading(false);
    }
  };

  createEffect(
    on(spaceId, () => {
      clearSearch();
      void refreshSources();
    }),
  );

  const search = async (rawQuery: string) => {
    const targetSpaceId = currentSpaceId();
    const query = rawQuery.trim();
    if (!targetSpaceId || !query) return null;
    const claim = latestSearch.claim(() => targetSpaceId === currentSpaceId());
    setSearchLoading(true);
    setSearchError(null);
    setSearchResult(null);
    try {
      const response = await fetch(
        `${queryPath("/api/mcp/search", targetSpaceId)}&q=${encodeURIComponent(query)}`,
      );
      const result = await parseApiResponse<McpRegistrySearchResult>(
        response,
        t("registrySearchFailed"),
      );
      if (!claim.won()) return null;
      setSearchResult(result);
      return result;
    } catch (cause) {
      if (!claim.won()) return null;
      setSearchError(
        cause instanceof Error && cause.message
          ? cause.message
          : t("registrySearchFailed"),
      );
      return null;
    } finally {
      if (claim.won()) setSearchLoading(false);
    }
  };

  const discoverDomain = async (rawDomain: string) => {
    const targetSpaceId = currentSpaceId();
    const domain = rawDomain.trim().toLowerCase();
    if (!targetSpaceId || !domain) return null;
    const claim = latestSearch.claim(() => targetSpaceId === currentSpaceId());
    setSearchLoading(true);
    setSearchError(null);
    setSearchResult(null);
    try {
      const response = await fetch(
        `${queryPath("/api/mcp/discover", targetSpaceId)}&domain=${encodeURIComponent(domain)}`,
      );
      const discovered = await parseApiResponse<McpServerCardDiscoveryResult>(
        response,
        t("serverCardDiscoveryFailed"),
      );
      if (!claim.won()) return null;
      const result: McpRegistrySearchResult = {
        query: domain,
        candidates: discovered.candidates,
        source_results: [],
        source_failures: discovered.failures.map((failure) => ({
          source_id: `server-card:${domain}`,
          source_name: domain,
          source_kind: "server_card",
          code: "server_card_error",
          message: failure.message,
          status: null,
        })),
        limitations: {
          mode: "experimental_server_card",
          upstream_search: "server_name_substring_only",
          cached_full_text_aggregation: false,
          credentials_supported: false,
          note: "Experimental SEP-2127 MCP Catalog and Server Card discovery.",
        },
        discovery: {
          type: "server_card",
          experimental: true,
          catalog_url: discovered.catalog_url,
        },
      };
      setSearchResult(result);
      return result;
    } catch (cause) {
      if (!claim.won()) return null;
      setSearchError(
        cause instanceof Error && cause.message
          ? cause.message
          : t("serverCardDiscoveryFailed"),
      );
      return null;
    } finally {
      if (claim.won()) setSearchLoading(false);
    }
  };

  const createSource = async (input: McpRegistrySourceInput) => {
    const targetSpaceId = currentSpaceId();
    if (!targetSpaceId) throw new Error(t("missingSpaceId"));
    const response = await fetch(
      queryPath("/api/mcp/registry-sources", targetSpaceId),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    const source = await parseApiResponse<McpRegistrySource>(
      response,
      t("registrySourceCreateFailed"),
    );
    await refreshSources();
    return source;
  };

  const updateSource = async (
    sourceId: string,
    patch: McpRegistrySourcePatch,
  ) => {
    const targetSpaceId = currentSpaceId();
    if (!targetSpaceId) throw new Error(t("missingSpaceId"));
    const response = await fetch(
      queryPath(
        `/api/mcp/registry-sources/${encodeURIComponent(sourceId)}`,
        targetSpaceId,
      ),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    );
    const source = await parseApiResponse<McpRegistrySource>(
      response,
      t("registrySourceUpdateFailed"),
    );
    await refreshSources();
    return source;
  };

  const deleteSource = async (sourceId: string) => {
    const targetSpaceId = currentSpaceId();
    if (!targetSpaceId) throw new Error(t("missingSpaceId"));
    const response = await fetch(
      queryPath(
        `/api/mcp/registry-sources/${encodeURIComponent(sourceId)}`,
        targetSpaceId,
      ),
      { method: "DELETE" },
    );
    await ensureApiSuccess(response, t("registrySourceDeleteFailed"));
    await refreshSources();
  };

  return {
    sources,
    sourcesLoading,
    sourcesError,
    refreshSources,
    searchResult,
    searchLoading,
    searchError,
    clearSearch,
    search,
    discoverDomain,
    createSource,
    updateSource,
    deleteSource,
  };
}
