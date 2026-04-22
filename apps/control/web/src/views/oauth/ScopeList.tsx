import { For, Show } from "solid-js";
import { useI18n } from "../../store/i18n.ts";

interface ScopeListProps {
  identity: string[];
  resources: string[];
}

export function ScopeList(props: ScopeListProps) {
  const { t } = useI18n();

  return (
    <div class="bg-[var(--color-bg-primary)] rounded-lg p-3 text-left">
      <Show
        when={props.identity.length > 0 || props.resources.length > 0}
        fallback={
          <div class="text-sm text-[var(--color-text-tertiary)]">
            {t("oauthScopeNone")}
          </div>
        }
      >
        <Show when={props.identity.length > 0}>
          <div class="text-xs font-semibold text-[var(--color-text-tertiary)] mb-1">
            {t("oauthScopeIdentity")}
          </div>
          <For each={props.identity}>
            {(scope) => (
              <div class="py-2 border-b border-[var(--color-border-primary)] text-sm text-[var(--color-text-secondary)]">
                {scope}
              </div>
            )}
          </For>
        </Show>
        <Show when={props.resources.length > 0}>
          <div class="text-xs font-semibold text-[var(--color-text-tertiary)] mt-2 mb-1">
            {t("oauthScopeResources")}
          </div>
          <For each={props.resources}>
            {(scope) => (
              <div class="py-2 border-b border-[var(--color-border-primary)] text-sm text-[var(--color-text-secondary)]">
                {scope}
              </div>
            )}
          </For>
        </Show>
      </Show>
    </div>
  );
}
