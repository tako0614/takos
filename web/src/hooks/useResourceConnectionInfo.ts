import { type Accessor, createEffect, createSignal, on } from "solid-js";
import { rpc, rpcJson, rpcPath } from "../lib/rpc.ts";
import type { Resource } from "../types/index.ts";

export interface ResourceConnectionInfo {
  type: string;
  name: string;
  status: string;
  connection: Record<string, string>;
}

export function useResourceConnectionInfo(resource: Accessor<Resource | null>) {
  const [connectionInfo, setConnectionInfo] = createSignal<
    ResourceConnectionInfo | null
  >(null);
  const [loadingConnection, setLoadingConnection] = createSignal(false);

  const fetchConnectionInfo = async () => {
    const currentResource = resource();
    if (!currentResource) {
      setConnectionInfo(null);
      return;
    }

    const resourceName = currentResource.name;
    setLoadingConnection(true);
    try {
      const res = await rpcPath(
        rpc,
        "resources",
        "by-name",
        ":name",
        "connection",
      ).$get({ param: { name: resourceName } });
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

  createEffect(on(() => resource()?.name, () => {
    if (resource()) {
      void fetchConnectionInfo();
    } else {
      setConnectionInfo(null);
      setLoadingConnection(false);
    }
  }));

  return {
    connectionInfo,
    loadingConnection,
    refreshConnectionInfo: fetchConnectionInfo,
  };
}
