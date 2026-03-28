import { useCallback, useEffect, useState } from 'react';
import { rpc, rpcJson } from '../lib/rpc';
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

  const [boundServices, setBoundServices] = useState<Array<{ id: string; slug: string; hostname: string }>>([]);
  const [loadingBindings, setLoadingBindings] = useState(false);

  const fetchBindings = useCallback(async () => {
    if (!resource) return;

    setLoadingBindings(true);
    try {
      const res = await rpc.resources['by-name'][':name'].$get({
        param: { name: resource.name },
      });

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
  }, [resource?.name]);

  const onRemoveBinding = useCallback(async (serviceId: string) => {
    if (!resource) return;

    try {
      const res = await rpc.resources['by-name'][':name'].bind[':serviceId'].$delete({
        param: { name: resource.name, serviceId },
      });
      await rpcJson(res);
      showToast('success', t('bindingRemoved'));
      await fetchBindings();
    } catch {
      showToast('error', t('failedToRemoveBinding'));
    }
  }, [resource?.name, fetchBindings, showToast, t]);

  useEffect(() => {
    if (!resource) {
      setBoundServices([]);
      return;
    }
    void fetchBindings();
  }, [resource?.name]);

  return {
    boundServices,
    loadingBindings,
    onRemoveBinding,
    refreshBindings: fetchBindings,
  };
}
