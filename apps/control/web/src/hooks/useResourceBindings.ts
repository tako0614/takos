import { createSignal, createEffect, on } from 'solid-js';
import { rpc, rpcJson, rpcPath } from '../lib/rpc';
import { useToast } from '../store/toast';
import { useI18n } from '../store/i18n';
import type { Resource } from '../types';

type ApiServiceBinding = {
  service_id: string;
  service_hostname: string | null;
  service_slug: string | null;
};

export function useResourceBindings(resource: Resource | null) {
  const { showToast } = useToast();
  const { t } = useI18n();

  const [boundServices, setBoundServices] = createSignal<Array<{ id: string; slug: string; hostname: string }>>([]);
  const [loadingBindings, setLoadingBindings] = createSignal(false);

  const fetchBindings = async () => {
    if (!resource) return;

    setLoadingBindings(true);
    try {
      const res = await rpcPath(rpc, 'resources', 'by-name', ':name').$get({
        param: { name: resource.name },
      }) as Response;

      const data = await rpcJson<{ bindings?: ApiServiceBinding[] }>(res);

      const map = new Map<string, { id: string; slug: string; hostname: string }>();
      for (const b of data.bindings || []) {
        if (!b.service_id) continue;
        if (map.has(b.service_id)) continue;

        map.set(b.service_id, {
          id: b.service_id,
          slug: b.service_slug || b.service_hostname || b.service_id,
          hostname: b.service_hostname || '',
        });
      }

      setBoundServices(Array.from(map.values()));
    } catch {
      setBoundServices([]);
    } finally {
      setLoadingBindings(false);
    }
  };

  const onRemoveBinding = async (serviceId: string) => {
    if (!resource) return;

    try {
      const res = await rpcPath(rpc, 'resources', 'by-name', ':name', 'bind', ':serviceId').$delete({
        param: { name: resource.name, serviceId },
      }) as Response;
      await rpcJson(res);
      showToast('success', t('bindingRemoved'));
      await fetchBindings();
    } catch {
      showToast('error', t('failedToRemoveBinding'));
    }
  };

  createEffect(on(() => resource?.name, () => {
    if (!resource) {
      setBoundServices([]);
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
