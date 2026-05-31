import { createSignal } from "solid-js";
import { useI18n } from "../../../store/i18n.ts";
import { Icons } from "../../../lib/Icons.tsx";
import type { Resource } from "../../../types/index.ts";
import {
  type ResourceConnectionInfo,
  useResourceConnectionInfo,
} from "../../../hooks/useResourceConnectionInfo.ts";
import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard.ts";

interface ResourceOverviewTabProps {
  resource: Resource;
}

export function ResourceOverviewTab(props: ResourceOverviewTabProps) {
  const { t } = useI18n();
  const resource = () => props.resource;
  const {
    connectionInfo,
    loadingConnection,
  } = useResourceConnectionInfo(resource);

  return (
    <div class="space-y-6" role="region" aria-label={t("overview")}>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
          <h4 class="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
            {t("resourceId")}
          </h4>
          <code class="text-sm text-zinc-900 dark:text-zinc-100 font-mono bg-zinc-100 dark:bg-zinc-700 px-2 py-1 rounded">
            {props.resource.id || "-"}
          </code>
        </div>
        <div class="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
          <h4 class="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
            {t("createdAt")}
          </h4>
          <span class="text-sm text-zinc-900 dark:text-zinc-100">
            {props.resource.created_at
              ? new Date(props.resource.created_at).toLocaleDateString()
              : "-"}
          </span>
        </div>
      </div>

      <div class="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
        <h4 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
          <Icons.Link class="w-4 h-4" aria-hidden="true" />
          {t("connectionInfo")}
        </h4>
        <ConnectionInfoDisplay
          connectionInfo={connectionInfo()}
          loading={loadingConnection()}
        />
      </div>

      <div class="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
        <h4 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
          <Icons.Key class="w-4 h-4" aria-hidden="true" />
          {t("resourceCredentials")}
        </h4>
        <div class="space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
          <p>{t("resourceCredentialsManagedByAccounts")}</p>
          <p class="text-zinc-500 dark:text-zinc-400">
            {t("resourceCredentialsNoLocalTokens")}
          </p>
        </div>
      </div>
    </div>
  );
}

// --- Internal sub-components (moved from ResourceDetail.tsx) ---

function ConnectionInfoDisplay(props: {
  connectionInfo: ResourceConnectionInfo | null;
  loading: boolean;
}) {
  const { t } = useI18n();
  const [copiedKey, setCopiedKey] = createSignal<string | null>(null);
  const { copied, copy } = useCopyToClipboard();

  const handleCopy = async (key: string, value: string) => {
    await copy(value);
    setCopiedKey(key);
  };

  return (
    <>
      {props.loading
        ? (
          <div
            class="flex items-center gap-2 text-zinc-500 dark:text-zinc-400"
            role="status"
          >
            <Icons.Loader class="w-4 h-4 animate-spin" aria-hidden="true" />
            <span>{t("loadingConnectionInfo")}</span>
          </div>
        )
        : !props.connectionInfo
        ? (
          <p class="text-sm text-zinc-500 dark:text-zinc-400">
            {t("connectionInfoNotAvailable")}
          </p>
        )
        : (
          <div class="space-y-3">
            {Object.entries(props.connectionInfo.connection).map((
              [key, value],
            ) => (
              <div class="flex items-center gap-3">
                <div class="flex-1 min-w-0">
                  <label class="block text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
                    {key.replace(/_/g, " ")}
                  </label>
                  <div class="flex items-center gap-2">
                    <code class="flex-1 text-sm text-zinc-900 dark:text-zinc-100 font-mono bg-zinc-100 dark:bg-zinc-700 px-3 py-2 rounded-lg truncate">
                      {value}
                    </code>
                    <button
                      type="button"
                      onClick={() => handleCopy(key, value)}
                      class="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                      aria-label={t("copyConnectionField", {
                        field: key.replace(/_/g, " "),
                      })}
                    >
                      {copied() && copiedKey() === key
                        ? (
                          <Icons.Check
                            class="w-4 h-4 text-green-600"
                            aria-hidden="true"
                          />
                        )
                        : <Icons.Copy class="w-4 h-4" aria-hidden="true" />}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
    </>
  );
}
