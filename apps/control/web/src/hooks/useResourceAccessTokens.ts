import { createSignal, createEffect, on } from 'solid-js';
import { rpc, rpcJson } from '../lib/rpc';
import { useToast } from '../store/toast';
import { useI18n } from '../store/i18n';
import type { Resource } from '../types';

export interface ResourceAccessToken {
  id: string;
  name: string;
  token?: string; // Only present on creation
  token_prefix: string;
  permission: 'read' | 'write';
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

export function useResourceAccessTokens(resource: Resource | null) {
  const { showToast } = useToast();
  const { t } = useI18n();

  const [tokens, setTokens] = createSignal<ResourceAccessToken[]>([]);
  const [loadingTokens, setLoadingTokens] = createSignal(false);
  const [connectionInfo, setConnectionInfo] = createSignal<ResourceConnectionInfo | null>(null);
  const [loadingConnection, setLoadingConnection] = createSignal(false);
  const [creatingToken, setCreatingToken] = createSignal(false);
  const [deletingTokenId, setDeletingTokenId] = createSignal<string | null>(null);

  const fetchTokens = async () => {
    if (!resource) return;
    setLoadingTokens(true);
    try {
      const res = await rpc.resources['by-name'][':name'].tokens.$get({
        param: { name: resource.name },
      });
      const data = await rpcJson<{ tokens: ResourceAccessToken[] }>(res);
      setTokens(data.tokens);
    } catch {
      setTokens([]);
    } finally {
      setLoadingTokens(false);
    }
  };

  const fetchConnectionInfo = async () => {
    if (!resource) return;
    setLoadingConnection(true);
    try {
      const res = await rpc.resources['by-name'][':name'].connection.$get({
        param: { name: resource.name },
      });
      const data = await rpcJson<ResourceConnectionInfo>(res);
      setConnectionInfo(data);
    } catch {
      setConnectionInfo(null);
    } finally {
      setLoadingConnection(false);
    }
  };

  const createToken = async (
    tokenName: string,
    permission: 'read' | 'write' = 'read',
    expiresInDays?: number
  ): Promise<ResourceAccessToken | null> => {
    if (!resource) return null;
    setCreatingToken(true);
    try {
      const res = await rpc.resources['by-name'][':name'].tokens.$post({
        param: { name: resource.name },
        json: {
          name: tokenName,
          permission,
          expires_in_days: expiresInDays,
        },
      });
      const data = await rpcJson<{ token: ResourceAccessToken }>(res);
      showToast('success', t('tokenCreated'));
      await fetchTokens();
      return data.token;
    } catch {
      showToast('error', t('failedToCreateToken'));
      return null;
    } finally {
      setCreatingToken(false);
    }
  };

  const deleteToken = async (tokenId: string): Promise<boolean> => {
    if (!resource) return false;
    setDeletingTokenId(tokenId);
    try {
      const res = await rpc.resources['by-name'][':name'].tokens[':tokenId'].$delete({
        param: { name: resource.name, tokenId },
      });
      await rpcJson(res);
      showToast('success', t('tokenDeleted'));
      await fetchTokens();
      return true;
    } catch {
      showToast('error', t('failedToDeleteToken'));
      return false;
    } finally {
      setDeletingTokenId(null);
    }
  };

  createEffect(on(() => resource?.name, () => {
    if (resource) {
      fetchTokens();
      fetchConnectionInfo();
    } else {
      setTokens([]);
      setConnectionInfo(null);
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
