import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";
import { Badge, Button, Card, Input } from "../../components/ui/index.ts";
import { useMcpRegistry } from "../../hooks/useMcpRegistry.ts";
import { useMcpServers } from "../../hooks/useMcpServers.ts";
import { Icons } from "../../lib/Icons.tsx";
import { getSpaceIdentifier } from "../../lib/spaces.ts";
import { useI18n, type TranslationKey } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";
import type {
  McpRegistrySearchCandidate,
  McpServerRecord,
  Space,
} from "../../types/index.ts";
import { ServerCard } from "../hub/ServerCard.tsx";
import {
  classifyConnectionInput,
  describeDirectConnection,
  isValidMcpServerName,
  type DirectConnectionDisclosure,
} from "./connection-input.ts";
import { RegistryCandidateCard } from "./RegistryCandidateCard.tsx";
import { RegistrySourcesPanel } from "./RegistrySourcesPanel.tsx";
import {
  deriveRegistryConnectionName,
  getRegistryCandidateConnectionInfo,
  registrySourceKindLabelKey,
} from "./registry-helpers.ts";
import { getConnectionEndpointDisclosure } from "./connection-disclosure.ts";
import { GitUrlInstallModal } from "../source/GitUrlInstallModal.tsx";

export interface ConnectionsPageProps {
  spaceId: string;
  spaces: Space[];
  initialServer?: string;
  onSpaceChange: (spaceId: string, connectionServer?: string) => void;
}

const AUTH_REFRESH_ATTEMPTS = 60;
const AUTH_REFRESH_INTERVAL_MS = 2_000;

function sameEndpoint(left: string, right: string): boolean {
  try {
    return new URL(left).toString() === new URL(right).toString();
  } catch {
    return left === right;
  }
}

export function ConnectionsPage(props: ConnectionsPageProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const {
    servers,
    loading,
    error,
    refresh,
    createExternalServer,
    reauthorizeServer,
    toggleServer,
    deleteServer,
    fetchServerTools,
    updateServerToolPolicy,
    exportConnections,
    importConnections,
  } = useMcpServers({ spaceId: () => props.spaceId });
  const registry = useMcpRegistry({ spaceId: () => props.spaceId });

  const [input, setInput] = createSignal("");
  const [feedbackKey, setFeedbackKey] = createSignal<TranslationKey | null>(
    null,
  );
  const [directConnection, setDirectConnection] =
    createSignal<DirectConnectionDisclosure | null>(null);
  const [selectedCandidate, setSelectedCandidate] =
    createSignal<McpRegistrySearchCandidate | null>(null);
  const [deployCandidate, setDeployCandidate] =
    createSignal<McpRegistrySearchCandidate | null>(null);
  const [connectionName, setConnectionName] = createSignal("");
  const [connecting, setConnecting] = createSignal(false);
  const [pendingAuthUrl, setPendingAuthUrl] = createSignal<string | null>(null);
  const [importAuthUrls, setImportAuthUrls] = createSignal<
    Array<{ name: string; url: string }>
  >([]);
  const [portableBusy, setPortableBusy] = createSignal(false);
  let appliedInitialServer = "";
  let authRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let importInput: HTMLInputElement | undefined;

  const classification = createMemo(() => classifyConnectionInput(input()));
  const connectionNameError = createMemo(() =>
    connectionName().length > 0 && !isValidMcpServerName(connectionName())
      ? t("mcpNameInvalid")
      : undefined,
  );

  const clearAuthRefresh = () => {
    if (authRefreshTimer !== undefined) {
      clearTimeout(authRefreshTimer);
      authRefreshTimer = undefined;
    }
  };

  const scheduleAuthRefresh = (
    isReady: (server: McpServerRecord) => boolean,
    attempt = 0,
  ) => {
    clearAuthRefresh();
    if (attempt >= AUTH_REFRESH_ATTEMPTS) return;
    authRefreshTimer = setTimeout(async () => {
      await refresh();
      if (servers().some(isReady)) {
        setPendingAuthUrl(null);
        showToast("success", t("connectionAuthorizationComplete"));
        clearAuthRefresh();
        return;
      }
      scheduleAuthRefresh(isReady, attempt + 1);
    }, AUTH_REFRESH_INTERVAL_MS);
  };

  const openDirectDisclosure = (value: string) => {
    registry.clearSearch();
    const disclosure = describeDirectConnection(value);
    if (!disclosure) {
      setDirectConnection(null);
      setFeedbackKey("connectionHttpsRequired");
      return;
    }
    setSelectedCandidate(null);
    setDirectConnection(disclosure);
    setConnectionName(disclosure.suggestedName);
    setFeedbackKey(null);
  };

  const handleInput = (value = input()) => {
    const result = classifyConnectionInput(value);
    switch (result.kind) {
      case "https_url":
        openDirectDisclosure(result.value);
        return;
      case "registry_id":
      case "search":
        setDirectConnection(null);
        setSelectedCandidate(null);
        setFeedbackKey(null);
        void registry.search(result.value);
        return;
      case "domain":
        setDirectConnection(null);
        setSelectedCandidate(null);
        setFeedbackKey(null);
        void registry.discoverDomain(result.value);
        return;
      case "unsupported_url":
        registry.clearSearch();
        setDirectConnection(null);
        setSelectedCandidate(null);
        setFeedbackKey("connectionHttpsRequired");
        return;
      case "empty":
        registry.clearSearch();
        setDirectConnection(null);
        setSelectedCandidate(null);
        setFeedbackKey("connectionInputRequired");
    }
  };

  const reviewRegistryCandidate = (candidate: McpRegistrySearchCandidate) => {
    const info = getRegistryCandidateConnectionInfo(candidate);
    if (info.status !== "connectable" || !info.endpoint) return;
    const disclosure = describeDirectConnection(info.endpoint);
    if (!disclosure) return;
    setSelectedCandidate(candidate);
    setDirectConnection(disclosure);
    setConnectionName(deriveRegistryConnectionName(candidate));
    setFeedbackKey(null);
  };

  createEffect(() => {
    const initialServer = props.initialServer?.trim() ?? "";
    if (!initialServer || initialServer === appliedInitialServer) return;
    appliedInitialServer = initialServer;
    setInput(initialServer);
    handleInput(initialServer);
  });

  onCleanup(clearAuthRefresh);

  const connectDirect = async () => {
    const disclosure = directConnection();
    const name = connectionName().trim();
    if (!disclosure || !isValidMcpServerName(name)) return;

    setConnecting(true);
    try {
      const knownServerIds = new Set(servers().map((server) => server.id));
      const result = await createExternalServer({
        name,
        url: disclosure.endpoint,
      });
      setDirectConnection(null);
      setSelectedCandidate(null);
      setInput("");
      setFeedbackKey(null);

      if (result.auth_url) {
        setPendingAuthUrl(result.auth_url);
        globalThis.open(result.auth_url, "_blank", "noopener,noreferrer");
        showToast("success", t("connectionAuthorizationOpened"));
        scheduleAuthRefresh(
          (server) =>
            !knownServerIds.has(server.id) &&
            sameEndpoint(server.url, disclosure.endpoint),
        );
      } else {
        setPendingAuthUrl(null);
        showToast("success", t("connectionAdded"));
      }
    } catch (cause) {
      showToast(
        "error",
        cause instanceof Error && cause.message
          ? cause.message
          : t("failedToCreateMcpServer"),
      );
    } finally {
      setConnecting(false);
    }
  };

  const handleExport = async () => {
    setPortableBusy(true);
    try {
      const exportDocument = await exportConnections();
      const blob = new Blob([JSON.stringify(exportDocument, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = globalThis.document.createElement("a");
      anchor.href = url;
      anchor.download = `takos-connections-${props.spaceId}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      showToast("success", t("connectionsExported"));
    } catch (cause) {
      showToast(
        "error",
        cause instanceof Error ? cause.message : t("connectionsExportFailed"),
      );
    } finally {
      setPortableBusy(false);
    }
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1024 * 1024) {
      showToast("error", t("connectionsImportTooLarge"));
      return;
    }
    setPortableBusy(true);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const result = await importConnections(parsed);
      setImportAuthUrls(
        result.connections.flatMap((connection) =>
          connection.authorization_url
            ? [{ name: connection.name, url: connection.authorization_url }]
            : [],
        ),
      );
      const failed =
        result.connections.filter((entry) => entry.status === "failed").length +
        result.registry_sources.filter((entry) => entry.status === "failed")
          .length;
      showToast(
        failed > 0 ? "error" : "success",
        failed > 0
          ? t("connectionsImportedWithFailures", { count: failed })
          : t("connectionsImported"),
      );
    } catch (cause) {
      showToast(
        "error",
        cause instanceof Error ? cause.message : t("connectionsImportFailed"),
      );
    } finally {
      setPortableBusy(false);
      if (importInput) importInput.value = "";
    }
  };

  return (
    <div class="flex h-full flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-900">
      <div class="flex-1 overflow-y-auto">
        <div class="mx-auto w-full max-w-5xl px-5 pb-12 pt-6 sm:px-8">
          <header class="flex flex-col gap-4 border-b border-zinc-200 pb-6 dark:border-zinc-800 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 class="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                {t("connections")}
              </h1>
              <p class="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
                {t("connectionsDescription")}
              </p>
            </div>
            <div class="flex flex-col gap-2 sm:items-end">
              <div class="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={portableBusy()}
                  onClick={() => void handleExport()}
                >
                  {t("connectionsExport")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={portableBusy()}
                  onClick={() => importInput?.click()}
                >
                  {t("connectionsImport")}
                </Button>
                <input
                  ref={importInput}
                  type="file"
                  accept="application/json,.json"
                  class="hidden"
                  onChange={(event) =>
                    void handleImportFile(event.currentTarget.files?.[0])
                  }
                />
              </div>
              <label class="min-w-52">
                <span class="sr-only">{t("connectionsSelectWorkspace")}</span>
                <select
                  value={props.spaceId}
                  onChange={(event) => {
                    const currentInput = classifyConnectionInput(input());
                    props.onSpaceChange(
                      event.currentTarget.value,
                      currentInput.kind === "https_url"
                        ? currentInput.value
                        : undefined,
                    );
                  }}
                  class="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                >
                  {props.spaces.map((space) => (
                    <option value={getSpaceIdentifier(space)}>
                      {space.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </header>

          <section class="py-6" aria-labelledby="connection-discover-title">
            <h2
              id="connection-discover-title"
              class="text-base font-semibold text-zinc-900 dark:text-zinc-100"
            >
              {t("addConnection")}
            </h2>
            <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {t("connectionInputDescription")}
            </p>
            <form
              class="mt-4 flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                handleInput();
              }}
            >
              <div class="flex-1">
                <Input
                  value={input()}
                  onInput={(event) => {
                    setInput(event.currentTarget.value);
                    setFeedbackKey(null);
                  }}
                  leftIcon={<Icons.Search class="h-5 w-5" />}
                  placeholder={t("connectionInputPlaceholder")}
                  aria-label={t("connectionInputPlaceholder")}
                />
              </div>
              <Button
                type="submit"
                disabled={classification().kind === "empty"}
              >
                {classification().kind === "https_url"
                  ? t("reviewConnection")
                  : t("search")}
              </Button>
            </form>

            <Show when={feedbackKey()}>
              {(key) => (
                <div class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                  {t(key())}
                </div>
              )}
            </Show>

            <Show when={pendingAuthUrl()}>
              {(authUrl) => (
                <div class="mt-3 flex flex-col gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200 sm:flex-row sm:items-center sm:justify-between">
                  <span>{t("connectionAuthorizationPending")}</span>
                  <a
                    href={authUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="font-medium underline underline-offset-2"
                  >
                    {t("continueAuthorization")}
                  </a>
                </div>
              )}
            </Show>

            <Show when={importAuthUrls().length > 0}>
              <div class="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200">
                <p class="font-medium">{t("connectionsImportAuthorization")}</p>
                <ul class="mt-2 grid gap-1">
                  {importAuthUrls().map((entry) => (
                    <li>
                      <a
                        href={entry.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="underline underline-offset-2"
                      >
                        {entry.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </Show>

            <Show when={registry.searchLoading()}>
              <div class="flex items-center justify-center gap-3 py-10 text-sm text-zinc-500 dark:text-zinc-400">
                <Icons.Loader class="h-5 w-5 animate-spin" />
                {t("registrySearching")}
              </div>
            </Show>

            <Show when={!registry.searchLoading() && registry.searchError()}>
              {(message) => (
                <div class="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                  {message()}
                </div>
              )}
            </Show>

            <Show when={!registry.searchLoading() && registry.searchResult()}>
              {(result) => (
                <div class="mt-5">
                  <div class="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h3 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {t("registrySearchResults")}
                      </h3>
                      <p class="text-xs text-zinc-500 dark:text-zinc-400">
                        {t("registrySearchQuery", { query: result().query })}
                      </p>
                    </div>
                    <span class="text-xs text-zinc-500 dark:text-zinc-400">
                      {t("registryResultCount", {
                        count: result().candidates.length,
                      })}
                    </span>
                  </div>

                  <Show when={result().discovery?.experimental}>
                    <div class="mt-3 flex gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200">
                      <Icons.Info class="mt-0.5 h-4 w-4 shrink-0" />
                      <p>{t("serverCardExperimentalNotice")}</p>
                    </div>
                  </Show>

                  <Show when={result().candidates.length === 0}>
                    <div class="mt-3 rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                      {t("registryNoResults")}
                    </div>
                  </Show>

                  <Show when={result().candidates.length > 0}>
                    <div class="mt-3 grid gap-3">
                      {result().candidates.map((candidate) => (
                        <RegistryCandidateCard
                          candidate={candidate}
                          onReview={reviewRegistryCandidate}
                          onDeploy={setDeployCandidate}
                        />
                      ))}
                    </div>
                  </Show>

                  <Show when={result().source_failures.length > 0}>
                    <div class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/60 dark:bg-amber-950/30">
                      <p class="text-sm font-medium text-amber-900 dark:text-amber-100">
                        {t("registrySomeSourcesFailed")}
                      </p>
                      <ul class="mt-2 grid gap-1 text-xs text-amber-800 dark:text-amber-200">
                        {result().source_failures.map((failure) => (
                          <li>
                            <span class="font-medium">
                              {failure.source_name}
                            </span>{" "}
                            (
                            {t(registrySourceKindLabelKey(failure.source_kind))}
                            ): {failure.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </Show>

                  <div class="mt-3 flex gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                    <Icons.Info class="mt-0.5 h-4 w-4 shrink-0" />
                    <p>{t("registrySearchLimitation")}</p>
                  </div>
                </div>
              )}
            </Show>

            <Show when={directConnection()}>
              {(direct) => (
                <Card class="mt-5" padding="lg">
                  <div class="flex flex-col gap-5">
                    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div class="flex flex-wrap items-center gap-2">
                          <h3 class="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                            {selectedCandidate()?.title || direct().hostname}
                          </h3>
                          <Badge>
                            {selectedCandidate()
                              ? t("registrySearchResult")
                              : t("connectionSourceDirect")}
                          </Badge>
                          <Badge variant="warning">
                            {t("connectionTrustUnverified")}
                          </Badge>
                          <Show when={selectedCandidate()}>
                            <Badge variant="warning">
                              {t("registryNoSafetyAssertion")}
                            </Badge>
                          </Show>
                        </div>
                        <p class="mt-1 break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">
                          {direct().endpoint}
                        </p>
                      </div>
                      <div class="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setDirectConnection(null);
                            setSelectedCandidate(null);
                          }}
                        >
                          {t("cancel")}
                        </Button>
                        <Button
                          size="sm"
                          isLoading={connecting()}
                          disabled={Boolean(connectionNameError())}
                          onClick={() => void connectDirect()}
                        >
                          {t("connect")}
                        </Button>
                      </div>
                    </div>

                    <dl class="grid gap-3 rounded-lg bg-zinc-50 p-4 text-sm dark:bg-zinc-800/50 sm:grid-cols-3">
                      <DisclosureItem
                        label={t("connectionEndpointDomain")}
                        value={
                          getConnectionEndpointDisclosure(direct().hostname)
                            .endpointDomain ?? t("registryNotAvailable")
                        }
                      />
                      <DisclosureItem
                        label={t("connectionConnectorOperator")}
                        value={
                          getConnectionEndpointDisclosure(direct().hostname)
                            .connectorOperator ??
                          t("connectionUnknownUnverified")
                        }
                      />
                      <DisclosureItem
                        label={t("connectionDataSentTo")}
                        value={
                          getConnectionEndpointDisclosure(direct().hostname)
                            .dataSentTo ?? t("registryNotAvailable")
                        }
                      />
                    </dl>

                    <Show when={selectedCandidate()}>
                      {(candidate) => (
                        <div class="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
                          <p class="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                            {t("registryProvenance")}
                          </p>
                          <p class="mt-1 break-all font-mono text-xs text-zinc-600 dark:text-zinc-300">
                            {candidate().name}
                          </p>
                          <div class="mt-2 flex flex-wrap gap-2">
                            {candidate().provenance.map((source) => (
                              <span class="inline-flex flex-wrap items-center gap-1">
                                <Badge>{source.source_name}</Badge>
                                <Badge>
                                  {t(
                                    registrySourceKindLabelKey(
                                      source.source_kind,
                                    ),
                                  )}
                                </Badge>
                                {source.preview ? (
                                  <Badge variant="warning">
                                    {t("registryPreview")}
                                  </Badge>
                                ) : null}
                                {source.best_effort ? (
                                  <Badge variant="warning">
                                    {t("registryBestEffort")}
                                  </Badge>
                                ) : null}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </Show>

                    <label>
                      <span class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {t("connectionName")}
                      </span>
                      <Input
                        value={connectionName()}
                        onInput={(event) =>
                          setConnectionName(event.currentTarget.value)
                        }
                        error={connectionNameError()}
                      />
                    </label>

                    <div class="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                      <Icons.AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
                      <p>{t("connectionUnverifiedWarning")}</p>
                    </div>
                  </div>
                </Card>
              )}
            </Show>
          </section>

          <RegistrySourcesPanel
            sources={registry.sources()}
            loading={registry.sourcesLoading()}
            error={registry.sourcesError()}
            onRefresh={registry.refreshSources}
            onCreate={registry.createSource}
            onUpdate={registry.updateSource}
            onDelete={registry.deleteSource}
          />

          <section
            class="mt-6 border-t border-zinc-200 pt-6 dark:border-zinc-800"
            aria-labelledby="connected-connections-title"
          >
            <div class="flex items-center justify-between gap-3">
              <div>
                <h2
                  id="connected-connections-title"
                  class="text-base font-semibold text-zinc-900 dark:text-zinc-100"
                >
                  {t("connectedConnections")}
                </h2>
                <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {t("connectedConnectionsDescription")}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Icons.RefreshCw class="h-4 w-4" />}
                onClick={() => void refresh()}
              >
                {t("refresh")}
              </Button>
            </div>

            <Show when={loading()}>
              <div class="flex items-center justify-center gap-3 py-12 text-sm text-zinc-500 dark:text-zinc-400">
                <Icons.Loader class="h-5 w-5 animate-spin" />
                {t("loading")}
              </div>
            </Show>

            <Show when={!loading() && error()}>
              {(message) => (
                <div class="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                  {message()}
                </div>
              )}
            </Show>

            <Show when={!loading() && !error() && servers().length === 0}>
              <div class="mt-5 rounded-lg border border-dashed border-zinc-300 bg-white/60 px-6 py-12 text-center dark:border-zinc-700 dark:bg-zinc-950/40">
                <Icons.Link class="mx-auto h-8 w-8 text-zinc-400" />
                <p class="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {t("noConnectionsYet")}
                </p>
                <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {t("managedConnectionsAppearAutomatically")}
                </p>
              </div>
            </Show>

            <Show when={!loading() && !error() && servers().length > 0}>
              <div class="mt-5 grid gap-3">
                {servers().map((server: McpServerRecord) => (
                  <ServerCard
                    server={server}
                    onToggle={() => void toggleServer(server)}
                    onDelete={() => void deleteServer(server)}
                    onReauthorize={() => {
                      void reauthorizeServer(server.id)
                        .then((result) => {
                          if (result.auth_url) {
                            setPendingAuthUrl(result.auth_url);
                            scheduleAuthRefresh(
                              (nextServer) =>
                                nextServer.id === server.id &&
                                nextServer.authorization_status ===
                                  "authorized",
                            );
                          }
                        })
                        .catch((cause) => {
                          showToast(
                            "error",
                            cause instanceof Error && cause.message
                              ? cause.message
                              : t("failedToReauthorizeMcpServer"),
                          );
                        });
                    }}
                    fetchServerTools={fetchServerTools}
                    updateServerToolPolicy={updateServerToolPolicy}
                  />
                ))}
              </div>
            </Show>
          </section>
        </div>
      </div>
      <Show when={deployCandidate()}>
        {(candidate) => (
          <GitUrlInstallModal
            isOpen={true}
            spaceId={props.spaceId}
            initialGitUrl={candidate().repository_url}
            initialRef={candidate().packages[0]?.version ?? candidate().version}
            initialModulePath={candidate().repository_subfolder ?? "."}
            onApplied={refresh}
            onClose={() => setDeployCandidate(null)}
          />
        )}
      </Show>
    </div>
  );
}

function DisclosureItem(props: { label: string; value: string }) {
  return (
    <div class="min-w-0">
      <dt class="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {props.label}
      </dt>
      <dd class="mt-1 truncate font-medium text-zinc-800 dark:text-zinc-200">
        {props.value}
      </dd>
    </div>
  );
}
