import { useCallback, useEffect, useState } from 'react';
import { rpc, rpcJson } from '../lib/rpc';
import { useToast } from './useToast';
import { useI18n } from '../store/i18n';
import type { Resource } from '../types';

export interface ResourceAccessToken {
  id: string;
  name: string;
  token?: string; // Only present on creation
  tokenPrefix: string;
  permission: 'read' | 'write';
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
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

  const [tokens, setTokens] = useState<ResourceAccessToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [connectionInfo, setConnectionInfo] = useState<ResourceConnectionInfo | null>(null);
  const [loadingConnection, setLoadingConnection] = useState(false);
  const [creatingToken, setCreatingToken] = useState(false);
  const [deletingTokenId, setDeletingTokenId] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
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
  }, [resource]);

  const fetchConnectionInfo = useCallback(async () => {
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
  }, [resource]);

  const createToken = useCallback(async (
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
  }, [resource, showToast, t, fetchTokens]);

  const deleteToken = useCallback(async (tokenId: string): Promise<boolean> => {
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
  }, [resource, showToast, t, fetchTokens]);

  useEffect(() => {
    if (resource) {
      fetchTokens();
      fetchConnectionInfo();
    } else {
      setTokens([]);
      setConnectionInfo(null);
    }
  }, [resource?.name]);

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
