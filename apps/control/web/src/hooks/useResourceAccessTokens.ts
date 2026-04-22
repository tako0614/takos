import { type Accessor, createEffect, createSignal, on } from "solid-js";
import { rpc, rpcJson } from "../lib/rpc.ts";
import { useToast } from "../store/toast.ts";
import { useI18n } from "../store/i18n.ts";
import type { Resource } from "../types/index.ts";

export interface ResourceAccessToken {
  id: string;
  name: string;
  token?: string; // Only present on creation
  token_prefix: string;
  permission: "read" | "write";
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface ResourceConnectionInfo {
  type: string;
  name: string;
  status: string;
  connection: Record<string, string>;
}

export function useResourceAccessTokens(resource: Accessor<Resource | null>) {
  const { showToast } = useToast();
  const { t } = useI18n();

  const [tokens, setTokens] = createSignal<ResourceAccessToken[]>([]);
  const [loadingTokens, setLoadingTokens] = createSignal(false);
  const [connectionInfo, setConnectionInfo] = createSignal<
    ResourceConnectionInfo | null
  >(null);
  const [loadingConnection, setLoadingConnection] = createSignal(false);
  const [creatingToken, setCreatingToken] = createSignal(false);
  const [deletingTokenId, setDeletingTokenId] = createSignal<string | null>(
    null,
  );

  const fetchTokens = async () => {
    const currentResource = resource();
    if (!currentResource) {
      setTokens([]);
      return;
    }

    const resourceName = currentResource.name;
    setLoadingTokens(true);
    try {
      const res = await rpc.resources["by-name"][":name"].tokens.$get({
        param: { name: resourceName },
      });
      const data = await rpcJson<{ tokens: ResourceAccessToken[] }>(res);
      if (resource()?.name === resourceName) {
        setTokens(data.tokens);
      }
    } catch {
      if (resource()?.name === resourceName) {
        setTokens([]);
      }
    } finally {
      if (resource()?.name === resourceName) {
        setLoadingTokens(false);
      }
    }
  };

  const fetchConnectionInfo = async () => {
    const currentResource = resource();
    if (!currentResource) {
      setConnectionInfo(null);
      return;
    }

    const resourceName = currentResource.name;
    setLoadingConnection(true);
    try {
      const res = await rpc.resources["by-name"][":name"].connection.$get({
        param: { name: resourceName },
      });
      const data = await rpcJson<ResourceConnectionInfo>(res);
      if (resource()?.name === resourceName) {
        setConnectionInfo(data);
      }
    } catch {
      if (resource()?.name === resourceName) {
        setConnectionInfo(null);
      }
    } finally {
      if (resource()?.name === resourceName) {
        setLoadingConnection(false);
      }
    }
  };

  const createToken = async (
    tokenName: string,
    permission: "read" | "write" = "read",
    expiresInDays?: number,
  ): Promise<ResourceAccessToken | null> => {
    const currentResource = resource();
    if (!currentResource) return null;

    const resourceName = currentResource.name;
    setCreatingToken(true);
    try {
      const res = await rpc.resources["by-name"][":name"].tokens.$post({
        param: { name: resourceName },
        json: {
          name: tokenName,
          permission,
          expires_in_days: expiresInDays,
        },
      });
      const data = await rpcJson<{ token: ResourceAccessToken }>(res);
      showToast("success", t("tokenCreated"));
      await fetchTokens();
      return data.token;
    } catch {
      showToast("error", t("failedToCreateToken"));
      return null;
    } finally {
      setCreatingToken(false);
    }
  };

  const deleteToken = async (tokenId: string): Promise<boolean> => {
    const currentResource = resource();
    if (!currentResource) return false;

    const resourceName = currentResource.name;
    setDeletingTokenId(tokenId);
    try {
      const res = await rpc.resources["by-name"][":name"].tokens[":tokenId"]
        .$delete({
          param: { name: resourceName, tokenId },
        });
      await rpcJson(res);
      showToast("success", t("tokenDeleted"));
      await fetchTokens();
      return true;
    } catch {
      showToast("error", t("failedToDeleteToken"));
      return false;
    } finally {
      setDeletingTokenId(null);
    }
  };

  createEffect(on(() => resource()?.name, () => {
    if (resource()) {
      void fetchTokens();
      void fetchConnectionInfo();
    } else {
      setTokens([]);
      setConnectionInfo(null);
      setLoadingTokens(false);
      setLoadingConnection(false);
    }
  }));

  return {
    tokens,
    loadingTokens,
    connectionInfo,
    loadingConnection,
    creatingToken,
    deletingTokenId,
    createToken,
    deleteToken,
    refreshTokens: fetchTokens,
    refreshConnectionInfo: fetchConnectionInfo,
  };
}
