import type { Accessor, Setter } from "solid-js";
import { useI18n } from "../store/i18n.ts";
import { rpc, rpcJson, rpcPath } from "../lib/rpc.ts";
import { useToast } from "../store/toast.ts";
import { getInstallSource, type SourceInstallSource } from "./sourceInstall.ts";
import type {
  SourceItem,
  SourceItemInstallation,
  SourceItemPackage,
} from "./useSourceData.ts";

interface AppInstallationApiRecord {
  installed: boolean;
  installation_id?: string | null;
  app_id?: string | null;
  status?: string | null;
  runtime_mode?: string | null;
  group_id?: string | null;
  group_name?: string | null;
  installed_version?: string | null;
  installed_commit?: string | null;
  installed_at?: string | null;
  updated_at?: string | null;
  deployed_at?: string | null;
}

interface AppInstallationMutationResponse {
  installation?: AppInstallationApiRecord;
}

function makeEmptyPackage(): SourceItemPackage {
  return {
    available: false,
    app_id: null,
    latest_version: null,
    latest_tag: null,
    release_tag: null,
    asset_id: null,
    tags: [],
    downloads: 0,
    certified: false,
    description: null,
    icon: null,
  };
}

function toRepositoryWebUrl(repositoryUrl: string): string {
  try {
    const parsed = new URL(repositoryUrl);
    parsed.pathname = parsed.pathname.replace(/\.git$/i, "");
    return parsed.toString();
  } catch {
    return repositoryUrl;
  }
}

function toInstallationFromAppInstallation(
  installation: AppInstallationApiRecord,
  item: SourceItem,
): SourceItemInstallation {
  return {
    installed: installation.installed,
    ...(installation.installation_id !== undefined
      ? { installation_id: installation.installation_id }
      : {}),
    ...(installation.app_id !== undefined
      ? { app_id: installation.app_id }
      : {}),
    ...(installation.status !== undefined
      ? { status: installation.status }
      : {}),
    ...(installation.runtime_mode !== undefined
      ? { runtime_mode: installation.runtime_mode }
      : {}),
    group_id: installation.group_id ?? null,
    group_name: installation.group_name ?? null,
    installed_version: installation.installed_version ??
      item.package?.latest_version ?? item.package?.latest_tag ?? null,
    installed_commit: installation.installed_commit ?? null,
    ...(installation.installed_at !== undefined
      ? { installed_at: installation.installed_at }
      : {}),
    ...(installation.updated_at !== undefined
      ? { updated_at: installation.updated_at }
      : {}),
    deployed_at: installation.deployed_at ?? null,
  };
}

function installableAppId(item: SourceItem): string | null {
  return item.installable_app?.app_id ?? null;
}

export interface UseSourceFetchActionsOptions {
  isAuthenticated: Accessor<boolean>;
  effectiveSpaceId: Accessor<string | null>;
  filter: Accessor<string>;
  onNavigateToRepo: (username: string, repoName: string) => void;
  onRequireLogin: () => void;
  setItems: Setter<SourceItem[]>;
  setSelectedItem: Setter<SourceItem | null>;
  setInstallingId: Setter<string | null>;
  refs: { requestSeqRef: number; appendInFlightRef: boolean };
  fetchMine: (requestId?: number) => Promise<void>;
  onInstallGitUrl?: (
    source: SourceInstallSource,
    item: SourceItem,
    operation?: "upgrade" | "rollback",
  ) => void | Promise<void>;
}

export interface UseSourceFetchActionsResult {
  install: (item: SourceItem) => Promise<void>;
  uninstall: (item: SourceItem) => Promise<void>;
  rollback: (item: SourceItem) => Promise<void>;
  toggleStar: (item: SourceItem) => Promise<void>;
  createRepo: (
    name: string,
    description: string,
    visibility: "public" | "private",
  ) => Promise<boolean>;
  openRepo: (item: SourceItem) => void;
  getItemPackage: (item: SourceItem) => SourceItemPackage;
}

export function useSourceFetchActions({
  isAuthenticated,
  effectiveSpaceId,
  filter,
  onNavigateToRepo,
  onRequireLogin,
  setItems,
  setSelectedItem,
  setInstallingId,
  refs,
  fetchMine,
  onInstallGitUrl,
}: UseSourceFetchActionsOptions): UseSourceFetchActionsResult {
  const { t } = useI18n();
  const { showToast } = useToast();

  const applyInstallationUpdate = (
    itemId: string,
    installation: SourceItemInstallation | undefined,
  ) => {
    const updateItem = (current: SourceItem): SourceItem =>
      current.id === itemId ? { ...current, installation } : current;
    setItems((prev) => prev.map(updateItem));
    setSelectedItem((prev) => (prev?.id === itemId ? updateItem(prev) : prev));
  };

  const install = async (item: SourceItem) => {
    if (!isAuthenticated()) {
      onRequireLogin();
      return;
    }
    const spaceId = effectiveSpaceId();
    if (!spaceId) {
      showToast("error", t("selectSpaceFirst"));
      return;
    }
    if (!item.package?.available) {
      showToast("error", t("noDeployableAppManifest"));
      return;
    }
    const installSource = getInstallSource(item);
    if (item.catalog_origin !== "default_app") {
      if (!onInstallGitUrl) {
        showToast("error", t("installFailed"));
        return;
      }
      await onInstallGitUrl(installSource, item);
      return;
    }
    if (item.installation?.installation_id) {
      if (!onInstallGitUrl) {
        showToast("error", t("installFailed"));
        return;
      }
      await onInstallGitUrl(installSource, item, "upgrade");
      return;
    }
    try {
      setInstallingId(item.id);
      const appId = item.catalog_origin === "default_app"
        ? installableAppId(item)
        : null;
      if (appId) {
        const response = await fetch(
          `/api/spaces/${encodeURIComponent(spaceId)}/app-installations/apply`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ app_id: appId }),
          },
        );
        const data = await rpcJson<AppInstallationMutationResponse>(response);
        const wasInstalled = item.installation?.installed === true;
        showToast(
          "success",
          t(wasInstalled ? "updatedItem" : "deployedItem", {
            name: item.name,
          }),
        );

        const timestamp = new Date().toISOString();
        const installation = data.installation
          ? toInstallationFromAppInstallation(data.installation, item)
          : {
            installed: true,
            installation_id: item.installation?.installation_id ?? null,
            app_id: appId,
            status: item.installation?.status ?? "installing",
            runtime_mode: item.installation?.runtime_mode ?? null,
            group_id: null,
            group_name: null,
            installed_version: item.package.latest_version ??
              item.installation?.installed_version ?? null,
            installed_commit: null,
            installed_at: item.installation?.installed_at ?? timestamp,
            updated_at: timestamp,
            deployed_at: null,
          };
        applyInstallationUpdate(item.id, installation);
        return;
      }

      showToast("error", t("installFailed"));
    } catch (err) {
      showToast(
        "error",
        err instanceof Error && err.message ? err.message : t("installFailed"),
      );
    } finally {
      setInstallingId(null);
    }
  };

  const uninstall = async (item: SourceItem) => {
    if (!isAuthenticated()) {
      onRequireLogin();
      return;
    }
    const spaceId = effectiveSpaceId();
    const installationId = item.installation?.installation_id;
    if (!spaceId || !installationId) {
      showToast("error", t("uninstallFailed"));
      return;
    }
    try {
      const response = await fetch(
        `/api/spaces/${encodeURIComponent(spaceId)}/app-installations/${
          encodeURIComponent(installationId)
        }`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "user removed app" }),
        },
      );
      await rpcJson(response);
      showToast("success", t("uninstalledItem", { name: item.name }));
      applyInstallationUpdate(item.id, undefined);
    } catch (err) {
      showToast(
        "error",
        err instanceof Error && err.message
          ? err.message
          : t("uninstallFailed"),
      );
    }
  };

  const rollback = async (item: SourceItem) => {
    if (!isAuthenticated()) {
      onRequireLogin();
      return;
    }
    if (!effectiveSpaceId() || !item.installation?.installation_id) return;
    if (!onInstallGitUrl) {
      showToast("error", t("rollbackFailed"));
      return;
    }
    const source = getInstallSource(item);
    await onInstallGitUrl(
      {
        ...source,
        ref: item.installation.installed_version ?? source.ref,
      },
      item,
      "rollback",
    );
  };

  const toggleStar = async (item: SourceItem) => {
    if (item.catalog_origin === "default_app") {
      return;
    }
    if (!isAuthenticated()) {
      onRequireLogin();
      return;
    }
    try {
      if (item.is_starred) {
        await rpcJson(
          await rpcPath(rpc, "repos", ":repoId", "star").$delete({
            param: { repoId: item.id },
          }),
        );
      } else {
        await rpcJson(
          await rpcPath(rpc, "repos", ":repoId", "star").$post({
            param: { repoId: item.id },
          }),
        );
      }
      const delta = item.is_starred ? -1 : 1;
      const updateItem = (i: SourceItem) =>
        i.id === item.id
          ? {
            ...i,
            is_starred: !i.is_starred,
            stars: Math.max(0, i.stars + delta),
          }
          : i;
      setItems((prev) => {
        const updated = prev.map(updateItem);
        if (filter() === "starred" && item.is_starred) {
          return updated.filter((i) => i.id !== item.id);
        }
        return updated;
      });
      setSelectedItem((prev) => {
        if (prev?.id !== item.id) return prev;
        if (filter() === "starred" && item.is_starred) {
          return null;
        }
        return updateItem(prev);
      });
    } catch {
      showToast("error", t("failedToUpdateStar"));
    }
  };

  const createRepo = async (
    name: string,
    description: string,
    visibility: "public" | "private",
  ): Promise<boolean> => {
    if (!isAuthenticated()) {
      onRequireLogin();
      return false;
    }
    if (!effectiveSpaceId()) return false;
    try {
      const response = await rpcPath(rpc, "spaces", ":spaceId", "repos").$post({
        param: { spaceId: effectiveSpaceId()! },
        json: { name, description, visibility },
      });
      await rpcJson(response);
      showToast("success", t("repositoryCreated"));
      if (filter() === "mine") {
        void fetchMine(refs.requestSeqRef);
      }
      return true;
    } catch {
      showToast("error", t("failedToCreateRepository"));
      return false;
    }
  };

  const openRepo = (item: SourceItem) => {
    if (item.catalog_origin === "default_app" && item.source?.repository_url) {
      globalThis.open(
        toRepositoryWebUrl(item.source.repository_url),
        "_blank",
        "noopener,noreferrer",
      );
      return;
    }
    if (item.owner.username && item.name) {
      onNavigateToRepo(item.owner.username, item.name);
    }
  };

  const getItemPackage = (item: SourceItem): SourceItemPackage =>
    item.package ?? makeEmptyPackage();

  return {
    install,
    uninstall,
    rollback,
    toggleStar,
    createRepo,
    openRepo,
    getItemPackage,
  };
}
