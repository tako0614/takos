import type { Accessor, Setter } from "solid-js";
import { rpc, rpcJson, rpcPath } from "../lib/rpc.ts";
import { useI18n } from "../store/i18n.ts";
import type { SourceItem, SourceItemInstallation } from "./useSourceData.ts";
import { PAGE_SIZE } from "./useSourcePagination.ts";
import { sourceInstallationKey } from "./sourceInstall.ts";

export interface UseSourceFetchQueriesOptions {
  isAuthenticated: Accessor<boolean>;
  effectiveSpaceId: Accessor<string | null>;
  debouncedQuery: Accessor<string>;
  sort: Accessor<string>;
  category: Accessor<string>;
  // Pagination state setters
  setItems: Setter<SourceItem[]>;
  setLoading: Setter<boolean>;
  setHasMore: Setter<boolean>;
  setTotal: Setter<number>;
  setSelectedItem: Setter<SourceItem | null>;
  refs: { requestSeqRef: number; appendInFlightRef: boolean };
}

export interface UseSourceFetchQueriesResult {
  fetchInstallations: () => Promise<Map<string, SourceItemInstallation>>;
  fetchAll: (
    offset?: number,
    append?: boolean,
    requestId?: number,
  ) => Promise<void>;
  fetchMine: (requestId?: number) => Promise<void>;
  fetchStarred: (
    offset?: number,
    append?: boolean,
    requestId?: number,
  ) => Promise<void>;
}

export function useSourceFetchQueries({
  isAuthenticated,
  effectiveSpaceId,
  debouncedQuery,
  sort,
  category,
  setItems,
  setLoading,
  setHasMore,
  setTotal,
  setSelectedItem,
  refs,
}: UseSourceFetchQueriesOptions): UseSourceFetchQueriesResult {
  const { t } = useI18n();
  // In-flight promise ref to deduplicate concurrent fetchInstallations calls.
  let installationsInFlight:
    | Promise<Map<string, SourceItemInstallation>>
    | null = null;

  const shouldReplaceInstallation = (
    current: SourceItemInstallation | undefined,
    candidate: SourceItemInstallation,
  ): boolean => {
    if (!current) return true;
    const currentTime = Date.parse(
      current.updated_at ?? current.deployed_at ?? current.installed_at ?? "",
    );
    const candidateTime = Date.parse(
      candidate.updated_at ?? candidate.deployed_at ??
        candidate.installed_at ?? "",
    );
    if (!Number.isNaN(candidateTime) && !Number.isNaN(currentTime)) {
      return candidateTime > currentTime;
    }
    if (!Number.isNaN(candidateTime)) return true;
    if (!Number.isNaN(currentTime)) return false;
    return false;
  };

  const fetchInstallationsImpl = async (): Promise<
    Map<string, SourceItemInstallation>
  > => {
    if (!isAuthenticated() || !effectiveSpaceId()) return new Map();
    try {
      const response = await fetch(
        `/api/spaces/${effectiveSpaceId()}/app-installations`,
      );
      if (!response.ok) throw new Error(t("failedToFetchInstallations"));
      const data = await rpcJson<{
        installations: Array<{
          id: string;
          installation_id?: string | null;
          app_id?: string | null;
          appId?: string | null;
          status?: string | null;
          mode?: string | null;
          runtime_mode?: string | null;
          created_at?: string | null;
          createdAt?: string | null;
          updated_at?: string | null;
          updatedAt?: string | null;
          source?: {
            gitUrl?: string | null;
            git_url?: string | null;
            url?: string | null;
            repository_url?: string | null;
            repositoryId?: string | null;
            repository_id?: string | null;
            resolved_repo_id?: string | null;
            ref?: string | null;
            refType?: "branch" | "tag" | "commit" | null;
            ref_type?: "branch" | "tag" | "commit" | null;
            commit?: string | null;
            commit_sha?: string | null;
          } | null;
        }>;
      }>(response);
      const map = new Map<string, SourceItemInstallation>();
      for (const pkg of data.installations || []) {
        const source = pkg.source ?? null;
        const sourceRef = source?.ref ?? null;
        const createdAt = pkg.created_at ?? pkg.createdAt ?? null;
        const updatedAt = pkg.updated_at ?? pkg.updatedAt ?? null;
        const installation = {
          installed: true,
          installation_id: pkg.installation_id ?? pkg.id,
          app_id: pkg.app_id ?? pkg.appId ?? null,
          status: pkg.status ?? null,
          runtime_mode: pkg.runtime_mode ?? pkg.mode ?? null,
          group_id: null,
          group_name: null,
          installed_version: sourceRef,
          installed_commit: source?.commit ?? source?.commit_sha ?? null,
          installed_at: createdAt,
          updated_at: updatedAt,
          deployed_at: null,
        };
        const repoId = source?.repositoryId ?? source?.repository_id ??
          source?.resolved_repo_id ?? null;
        if (
          repoId &&
          shouldReplaceInstallation(map.get(repoId), installation)
        ) {
          map.set(repoId, installation);
        }
        const appId = installation.app_id;
        if (appId && shouldReplaceInstallation(map.get(appId), installation)) {
          map.set(appId, installation);
        }
        const repositoryUrl = source?.gitUrl ?? source?.git_url ??
          source?.repository_url ?? source?.url ?? null;
        if (repositoryUrl && sourceRef) {
          const sourceRefType = source?.refType ?? source?.ref_type ?? null;
          const refTypes = sourceRefType
            ? [sourceRefType]
            : (["branch", "tag", "commit"] as const);
          for (const refType of refTypes) {
            const key = sourceInstallationKey({
              repository_url: repositoryUrl,
              ref: sourceRef,
              ref_type: refType,
            });
            if (
              key &&
              shouldReplaceInstallation(map.get(key), installation)
            ) {
              map.set(key, installation);
            }
          }
        }
      }
      return map;
    } catch {
      return new Map();
    }
  };

  // Memoized wrapper that deduplicates concurrent calls
  const fetchInstallations = (): Promise<
    Map<string, SourceItemInstallation>
  > => {
    if (installationsInFlight) {
      return installationsInFlight;
    }
    const promise = fetchInstallationsImpl().finally(() => {
      installationsInFlight = null;
    });
    installationsInFlight = promise;
    return promise;
  };

  // Fetch catalog (all filter)
  const fetchAll = async (
    offset = 0,
    append = false,
    requestId = refs.requestSeqRef,
  ) => {
    if (requestId !== refs.requestSeqRef) return;
    try {
      setLoading(true);
      const queryParams: Record<string, string> = {
        limit: String(PAGE_SIZE),
        offset: String(offset),
        sort: sort(),
        type: "all",
      };
      if (debouncedQuery().trim()) queryParams.q = debouncedQuery().trim();
      if (category()) queryParams.category = category();
      if (effectiveSpaceId()) queryParams.space_id = effectiveSpaceId()!;

      const catalogResponse = await rpcPath(rpc, "explore", "catalog").$get({
        query: queryParams,
      });

      const data = await rpcJson<{
        items: Array<{
          repo: {
            id: string;
            name: string;
            description: string | null;
            visibility: "public";
            default_branch: string;
            stars: number;
            forks: number;
            category: string | null;
            language: string | null;
            license: string | null;
            is_starred: boolean;
            created_at: string;
            updated_at: string;
            space: { id: string; name: string };
            owner: {
              id: string;
              name: string;
              username: string;
              avatar_url: string | null;
            };
            catalog_origin?: "repository" | "default_app";
          };
          package: {
            available: boolean;
            app_id: string | null;
            latest_version: string | null;
            latest_tag: string | null;
            release_id: string | null;
            release_tag: string | null;
            asset_id: string | null;
            description: string | null;
            icon: string | null;
            category: string | null;
            tags: string[];
            downloads: number;
            rating_avg: number | null;
            rating_count: number;
            publish_status: string;
            certified: boolean;
            published_at: string | null;
          };
          source?: {
            kind: "git_ref";
            repository_url: string;
            ref: string;
            ref_type: "branch" | "tag" | "commit";
            backend?: "cloudflare" | "local" | "aws" | "gcp" | "k8s" | null;
            env?: string | null;
          };
          installable_app?: {
            app_id: string;
            name: string;
            description: string | null;
            publisher: string | null;
            homepage: string | null;
            source_path: string | null;
            runtime_modes: string[];
            bindings: Array<{
              name: string;
              type: string;
              required: boolean;
            }>;
          };
          installation?: {
            installed: boolean;
            installation_id?: string | null;
            app_id?: string | null;
            status?: string | null;
            runtime_mode?: string | null;
            group_id?: string | null;
            group_name?: string | null;
            installed_version: string | null;
            installed_commit?: string | null;
            installed_at?: string | null;
            updated_at?: string | null;
            deployed_at: string | null;
          };
        }>;
        total: number;
        has_more: boolean;
      }>(catalogResponse);

      if (requestId !== refs.requestSeqRef) return;

      const newItems: SourceItem[] = (data.items || []).map((item) => {
        const installation = item.installation
          ? {
            installed: item.installation.installed,
            ...(item.installation.installation_id !== undefined
              ? { installation_id: item.installation.installation_id }
              : {}),
            ...(item.installation.app_id !== undefined
              ? { app_id: item.installation.app_id }
              : {}),
            ...(item.installation.status !== undefined
              ? { status: item.installation.status }
              : {}),
            ...(item.installation.runtime_mode !== undefined
              ? { runtime_mode: item.installation.runtime_mode }
              : {}),
            group_id: item.installation.group_id ?? null,
            group_name: item.installation.group_name ?? null,
            installed_version: item.installation.installed_version,
            installed_commit: item.installation.installed_commit ?? null,
            ...(item.installation.installed_at !== undefined
              ? { installed_at: item.installation.installed_at }
              : {}),
            ...(item.installation.updated_at !== undefined
              ? { updated_at: item.installation.updated_at }
              : {}),
            deployed_at: item.installation.deployed_at,
          }
          : undefined;
        const sourceItem: SourceItem = {
          id: item.repo.id,
          name: item.repo.name,
          description: item.repo.description,
          visibility: item.repo.visibility,
          default_branch: item.repo.default_branch,
          updated_at: item.repo.updated_at,
          stars: item.repo.stars,
          forks: item.repo.forks,
          language: item.repo.language,
          license: item.repo.license,
          category: item.repo.category,
          is_starred: item.repo.is_starred,
          is_mine: false,
          owner: item.repo.owner,
          space: item.repo.space,
          catalog_origin: item.repo.catalog_origin ?? "repository",
          installable_app: item.installable_app,
          source: item.source,
          package: {
            available: item.package.available,
            app_id: item.package.app_id,
            latest_version: item.package.latest_version,
            latest_tag: item.package.latest_tag,
            release_tag: item.package.release_tag,
            asset_id: item.package.asset_id,
            tags: item.package.tags,
            downloads: item.package.downloads,
            certified: item.package.certified,
            description: item.package.description,
            icon: item.package.icon,
          },
        };
        return {
          ...sourceItem,
          installation,
        };
      });

      setItems((
        prev,
      ) => (append
        ? [
          ...prev,
          ...newItems.filter((item) =>
            !prev.some((existing) => existing.id === item.id)
          ),
        ]
        : newItems)
      );
      setHasMore(Boolean(data.has_more));
      setTotal(data.total || 0);
    } catch {
      if (requestId !== refs.requestSeqRef) return;
      setHasMore(false);
      if (!append) {
        setItems([]);
        setSelectedItem(null);
        setTotal(0);
      }
    } finally {
      if (requestId === refs.requestSeqRef) {
        setLoading(false);
      }
      if (append) {
        refs.appendInFlightRef = false;
      }
    }
  };

  // Fetch my repos (mine filter)
  const fetchMine = async (requestId = refs.requestSeqRef) => {
    if (requestId !== refs.requestSeqRef) return;
    if (!isAuthenticated()) {
      setItems([]);
      setSelectedItem(null);
      setHasMore(false);
      setTotal(0);
      return;
    }
    if (!effectiveSpaceId()) {
      setItems([]);
      setSelectedItem(null);
      setHasMore(false);
      setTotal(0);
      return;
    }
    try {
      setLoading(true);
      const [reposResponse, installMap] = await Promise.all([
        rpcPath(rpc, "spaces", ":spaceId", "repos").$get({
          param: { spaceId: effectiveSpaceId()! },
        }),
        fetchInstallations(),
      ]);
      const data = await rpcJson<{
        repositories: Array<{
          id: string;
          name: string;
          description: string | null;
          visibility: "public" | "private";
          updated_at: string;
          stars?: number;
          stars_count?: number;
          forks?: number;
          forks_count?: number;
          is_starred?: boolean;
          owner?: {
            id?: string;
            name: string;
            username?: string | null;
            avatar_url: string | null;
          };
        }>;
      }>(reposResponse);

      if (requestId !== refs.requestSeqRef) return;

      let repos = data.repositories || [];
      if (debouncedQuery().trim()) {
        const q = debouncedQuery().toLowerCase();
        repos = repos.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            (r.description || "").toLowerCase().includes(q),
        );
      }

      const newItems: SourceItem[] = repos.map((repo) => ({
        id: repo.id,
        name: repo.name,
        description: repo.description,
        visibility: repo.visibility,
        default_branch: "main",
        updated_at: repo.updated_at,
        stars: repo.stars_count ?? repo.stars ?? 0,
        forks: repo.forks_count ?? repo.forks ?? 0,
        is_starred: repo.is_starred ?? false,
        is_mine: true,
        catalog_origin: "repository",
        owner: repo.owner
          ? {
            id: repo.owner.id,
            name: repo.owner.name || repo.owner.username || "unknown",
            username: repo.owner.username || "",
            avatar_url: repo.owner.avatar_url ?? null,
          }
          : { name: "unknown", username: "" },
        installation: installMap.get(repo.id),
      }));

      setItems(newItems);
      setHasMore(false);
      setTotal(newItems.length);
    } catch {
      if (requestId !== refs.requestSeqRef) return;
      setItems([]);
      setSelectedItem(null);
      setHasMore(false);
      setTotal(0);
    } finally {
      if (requestId === refs.requestSeqRef) {
        setLoading(false);
      }
    }
  };

  // Fetch starred repos (starred filter)
  const fetchStarred = async (
    offset = 0,
    append = false,
    requestId = refs.requestSeqRef,
  ) => {
    if (requestId !== refs.requestSeqRef) return;
    if (!isAuthenticated()) {
      if (!append) {
        setItems([]);
        setSelectedItem(null);
        setHasMore(false);
        setTotal(0);
      }
      return;
    }
    try {
      setLoading(true);
      const [reposResponse, installMap] = await Promise.all([
        rpcPath(rpc, "repos", "starred").$get({
          query: { limit: String(PAGE_SIZE), offset: String(offset) },
        }),
        fetchInstallations(),
      ]);
      const data = await rpcJson<{
        repos: Array<{
          id: string;
          name: string;
          description: string | null;
          visibility: "public" | "private";
          updated_at: string;
          stars?: number;
          stars_count?: number;
          forks?: number;
          forks_count?: number;
          is_starred?: boolean;
          owner?: {
            id?: string;
            name: string;
            username?: string | null;
            avatar_url: string | null;
          };
        }>;
        has_more?: boolean;
        total?: number;
      }>(reposResponse);

      if (requestId !== refs.requestSeqRef) return;

      const newItems: SourceItem[] = (data.repos || []).map((repo) => ({
        id: repo.id,
        name: repo.name,
        description: repo.description,
        visibility: repo.visibility,
        default_branch: "main",
        updated_at: repo.updated_at,
        stars: repo.stars_count ?? repo.stars ?? 0,
        forks: repo.forks_count ?? repo.forks ?? 0,
        is_starred: true,
        is_mine: false,
        catalog_origin: "repository",
        owner: repo.owner
          ? {
            id: repo.owner.id,
            name: repo.owner.name,
            username: repo.owner.username || "",
            avatar_url: repo.owner.avatar_url,
          }
          : { name: "unknown", username: "" },
        installation: installMap.get(repo.id),
      }));

      setItems((
        prev,
      ) => (append
        ? [
          ...prev,
          ...newItems.filter((item) =>
            !prev.some((existing) => existing.id === item.id)
          ),
        ]
        : newItems)
      );
      setHasMore(Boolean(data.has_more));
      setTotal(data.total || 0);
    } catch {
      if (requestId !== refs.requestSeqRef) return;
      setHasMore(false);
      if (!append) {
        setItems([]);
        setSelectedItem(null);
        setTotal(0);
      }
    } finally {
      if (requestId === refs.requestSeqRef) {
        setLoading(false);
      }
      if (append) {
        refs.appendInFlightRef = false;
      }
    }
  };

  return {
    fetchInstallations,
    fetchAll,
    fetchMine,
    fetchStarred,
  };
}
