import { type Accessor, createEffect, createSignal, on } from "solid-js";
import { rpc, rpcJson, rpcPath } from "../lib/rpc.ts";
import { useToast } from "../store/toast.ts";
import { useI18n } from "../store/i18n.ts";
import type { Resource } from "../types/index.ts";

type ApiServiceBinding = {
  service_id: string;
  service_hostname: string | null;
  service_slug: string | null;
};

type ResourceSource = Accessor<Resource | null> | Resource | null;

function toResourceAccessor(
  resource: ResourceSource,
): Accessor<Resource | null> {
  if (typeof resource === "function") {
    return resource;
  }
  return () => resource;
}

export function useResourceBindings(resourceSource: ResourceSource) {
  const { showToast } = useToast();
  const { t } = useI18n();
  const resource = toResourceAccessor(resourceSource);

  const [boundServices, setBoundServices] = createSignal<
    Array<{ id: string; slug: string; hostname: string }>
  >([]);
  const [loadingBindings, setLoadingBindings] = createSignal(false);

  const fetchBindings = async () => {
    const currentResource = resource();
    if (!currentResource) {
      setBoundServices([]);
      return;
    }

    const resourceName = currentResource.name;
    setLoadingBindings(true);
    try {
      const res = await rpcPath(rpc, "resources", "by-name", ":name").$get({
        param: { name: resourceName },
      });

      const data = await rpcJson<{ bindings?: ApiServiceBinding[] }>(res);

      const map = new Map<
        string,
        { id: string; slug: string; hostname: string }
      >();
      for (const b of data.bindings || []) {
        if (!b.service_id) continue;
        if (map.has(b.service_id)) continue;

        map.set(b.service_id, {
          id: b.service_id,
          slug: b.service_slug || b.service_hostname || b.service_id,
          hostname: b.service_hostname || "",
        });
      }

      if (resource()?.name === resourceName) {
        setBoundServices(Array.from(map.values()));
      }
    } catch {
      if (resource()?.name === resourceName) {
        setBoundServices([]);
      }
    } finally {
      if (resource()?.name === resourceName) {
        setLoadingBindings(false);
      }
    }
  };

  const onRemoveBinding = async (serviceId: string) => {
    const currentResource = resource();
    if (!currentResource) return;

    const resourceName = currentResource.name;
    try {
      const res = await rpcPath(
        rpc,
        "resources",
        "by-name",
        ":name",
        "bind",
        ":serviceId",
      ).$delete({
        param: { name: resourceName, serviceId },
      });
      await rpcJson(res);
      showToast("success", t("bindingRemoved"));
      await fetchBindings();
    } catch {
      showToast("error", t("failedToRemoveBinding"));
    }
  };

  createEffect(on(() => resource()?.name, () => {
    if (!resource()) {
      setBoundServices([]);
      setLoadingBindings(false);
      return;
    }
    void fetchBindings();
  }));

  return {
    boundServices,
    loadingBindings,
    onRemoveBinding,
    refreshBindings: fetchBindings,
  };
}
