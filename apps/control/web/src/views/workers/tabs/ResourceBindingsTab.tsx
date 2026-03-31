import { createSignal } from 'solid-js';
import { useI18n } from '../../../store/i18n.ts';
import { Icons } from '../../../lib/Icons.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import type { Resource } from '../../../types/index.ts';
import { useResourceBindings } from '../../../hooks/useResourceBindings.ts';

interface ResourceBindingsTabProps {
  resource: Resource;
}

export function ResourceBindingsTab({ resource }: ResourceBindingsTabProps) {
  const { t } = useI18n();
  const { boundServices, loadingBindings, onRemoveBinding } = useResourceBindings(resource);
  const [removingBindingId, setRemovingBindingId] = createSignal<string | null>(null);

  const handleRemoveBinding = async (serviceId: string) => {
    setRemovingBindingId(serviceId);
    try {
      await onRemoveBinding(serviceId);
    } finally {
      setRemovingBindingId(null);
    }
  };

  return (
    <div class="space-y-4" role="region" aria-label={t('bindings')}>
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{t('boundWorkers')}</h3>
          <p class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{t('boundWorkersHint')}</p>
        </div>
      </div>

      {loadingBindings() ? (
        <div class="flex items-center justify-center py-12" role="status" aria-label="Loading bindings">
          <Icons.Loader class="w-6 h-6 animate-spin text-zinc-400" aria-hidden="true" />
        </div>
      ) : boundServices().length === 0 ? (
        <div class="text-center py-12 border border-zinc-200 dark:border-zinc-700 rounded-xl bg-zinc-50 dark:bg-zinc-800">
          <Icons.Link class="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" aria-hidden="true" />
          <p class="text-zinc-500 dark:text-zinc-400">{t('noBindings')}</p>
          <p class="text-sm text-zinc-400 dark:text-zinc-500 mt-1">{t('noBindingsHint')}</p>
        </div>
      ) : (
        <ul class="space-y-2" aria-label="Bound services">
          {boundServices().map((service: { id: string; slug: string; hostname: string }) => (
            <li

              class="flex items-center justify-between p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
            >
              <div class="flex items-center gap-3">
                <span class="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-700 flex items-center justify-center" aria-hidden="true">
                  <Icons.Server class="w-5 h-5 text-zinc-500 dark:text-zinc-400" />
                </span>
                <div>
                  <p class="font-medium text-zinc-900 dark:text-zinc-100">{service.slug}</p>
                  <a
                    href={`https://${service.hostname}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-sm text-zinc-500 dark:text-zinc-400 hover:underline flex items-center gap-1"
                    aria-label={`Open ${service.hostname} in new tab`}
                  >
                    {service.hostname}
                    <Icons.ExternalLink class="w-3 h-3" aria-hidden="true" />
                  </a>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveBinding(service.id)}
                disabled={removingBindingId() === service.id}
                isLoading={removingBindingId() === service.id}
                class="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                aria-label={`Remove binding for ${service.slug}`}
              >
                {t('removeBinding')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
