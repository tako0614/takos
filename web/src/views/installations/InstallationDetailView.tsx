/**
 * Installation detail (overview) screen.
 *
 * Ported from takosumi dashboard-ui `routes/apps/[id]/index.tsx` plus its
 * installation-detail sub-components (WorkloadServicesSection, MaterializeForm,
 * ExportForm, EventsSection, OidcClientSection, OutputValue), AppDetailNav, and
 * the app-launch helper. The conversion folds all of those into this single
 * self-contained module: SolidStart SSR loaders become client-side
 * createResource/fetch against the same-origin `/v1/*` account plane (mounted
 * in-process at the worker origin root), `lucide-solid` icons map onto the
 * takos `Icons` set, and the dashboard chrome comes from the shared
 * `views/account` shell.
 */
import {
  createResource,
  createSignal,
  For,
  Match,
  Show,
  Switch,
  type JSX,
} from "solid-js";
import { A, useLocation, useParams } from "@solidjs/router";
import { Icons } from "../../lib/Icons.tsx";
import AppShell from "../account/components/shell/AppShell.tsx";
import Page from "../account/components/auth/Page.tsx";
import AppStatusPill from "../account/components/AppStatusPill.tsx";
import {
  ApiError,
  type ExportOperation,
  type Installation,
  type OidcClientConfig,
  rpc,
  type RotateWorkloadServiceTokenResult,
  type WorkloadService,
} from "../account/lib/api.ts";
import { ActionError, createAction } from "../account/lib/action.tsx";

export default function InstallationDetailView() {
  return <Page>{() => <Inner />}</Page>;
}

function Inner() {
  const params = useParams<{ id: string }>();
  const [app, { refetch }] = createResource(
    () => params.id,
    rpc.installations.get,
  );
  const [services, { refetch: refetchServices }] = createResource(
    () => params.id,
    rpc.installations.services,
  );
  return (
    <AppShell>
      <Switch>
        <Match when={app.loading}>
          <div class="skel-block tall" />
        </Match>
        <Match when={app.error}>
          <div class="page-header">
            <h1>取得に失敗しました</h1>
          </div>
          <p>{(app.error as ApiError).message}</p>
          <a
            href="/installations"
            class="btn btn-secondary"
            style="margin-top: 16px;"
          >
            Apps 一覧へ戻る
          </a>
        </Match>
        <Match when={app()}>
          {(a) => (
            <>
              <div class="page-header">
                <h1>
                  {a().appId} <AppStatusPill status={a().status} />
                </h1>
                <p class="page-sub">
                  installation id: <code>{a().installationId}</code>
                </p>
              </div>
              <AppDetailNav installationId={a().installationId} />

              {(() => {
                const launch = appDetailLaunchState(a(), {
                  origin:
                    typeof location === "undefined"
                      ? "https://app.takosumi.com"
                      : location.origin,
                  hostname:
                    typeof location === "undefined"
                      ? "app.takosumi.com"
                      : location.hostname,
                });
                return (
                  <section class="detail-section">
                    <h2>Launch</h2>
                    <p class="muted">{launch.description}</p>
                    <Show when={launch.href}>
                      {(href) => (
                        <a href={href()} class="btn btn-primary">
                          <Icons.Play class="w-4 h-4" /> {launch.label}
                        </a>
                      )}
                    </Show>
                  </section>
                );
              })()}

              <section class="detail-section">
                <h2>Source</h2>
                <dl class="kv-list">
                  <dt>Git URL</dt>
                  <dd>
                    <code>{a().sourceGitUrl ?? "—"}</code>
                  </dd>
                  <dt>Ref</dt>
                  <dd>
                    <code>{a().sourceRef ?? "—"}</code>
                  </dd>
                  <dt>Commit</dt>
                  <dd>
                    <code>{a().sourceCommit ?? "—"}</code>
                  </dd>
                  <dt>Plan digest</dt>
                  <dd>
                    <code>{a().planDigest ?? "—"}</code>
                  </dd>
                  <dt>Artifact digest</dt>
                  <dd>
                    <code>{a().artifactDigest ?? "—"}</code>
                  </dd>
                  <dt>Mode</dt>
                  <dd>{a().mode ?? "—"}</dd>
                  <dt>Space</dt>
                  <dd>{a().spaceId ?? "—"}</dd>
                  <dt>Installed by</dt>
                  <dd>
                    <code>{a().createdBySubject ?? "—"}</code>
                  </dd>
                  <dt>Installed at</dt>
                  <dd>{a().createdAt ?? "—"}</dd>
                </dl>
              </section>

              <section class="detail-section">
                <h2>Deployment outputs</h2>
                <Show
                  when={(a().deploymentOutputs ?? []).length > 0}
                  fallback={<p class="muted">—</p>}
                >
                  <dl class="kv-list">
                    <For each={a().deploymentOutputs ?? []}>
                      {(output) => (
                        <>
                          <dt>{output.name}</dt>
                          <dd>
                            <code>{output.kind}</code>{" "}
                            <OutputValue value={output.value} />
                          </dd>
                        </>
                      )}
                    </For>
                  </dl>
                </Show>
              </section>

              <WorkloadServicesSection
                installationId={a().installationId}
                services={services()}
                loading={services.loading}
                error={services.error}
                onRotated={() => void refetchServices()}
              />

              <OidcClientSection client={a().oidcClient} />

              <section class="detail-section">
                <h2>Operations</h2>
                <MaterializeForm
                  installation={a()}
                  onDone={() => void refetch()}
                />
                <ExportForm installationId={a().installationId} />
              </section>

              <EventsSection installationId={a().installationId} />

              <section class="detail-section">
                <p class="muted">Uninstall は Danger zone から実行できます。</p>
                <a href="/installations" class="btn btn-secondary">
                  ← Apps 一覧へ戻る
                </a>
              </section>
            </>
          )}
        </Match>
      </Switch>
    </AppShell>
  );
}

// ===========================================================================
// AppDetailNav (ported from components/apps/AppDetailNav.tsx)
// ===========================================================================

const DETAIL_NAV_TABS = [
  { suffix: "", label: "Overview" },
  { suffix: "/danger", label: "Danger" },
];

function AppDetailNav(props: { installationId: string }) {
  const loc = useLocation();
  const base = `/installations/${encodeURIComponent(props.installationId)}`;
  const isActive = (suffix: string) => {
    const target = base + suffix;
    if (suffix === "") {
      return loc.pathname === target || loc.pathname === target + "/";
    }
    return loc.pathname === target;
  };
  return (
    <nav class="detail-nav" aria-label="App sections">
      {DETAIL_NAV_TABS.map((t) => (
        <A
          href={base + t.suffix}
          class="detail-nav-link"
          classList={{ active: isActive(t.suffix) }}
        >
          {t.label}
        </A>
      ))}
    </nav>
  );
}

// ===========================================================================
// OutputValue (ported from components/apps/installation-detail/OutputValue.tsx)
// ===========================================================================

function OutputValue(props: { readonly value: unknown }): JSX.Element {
  const value = () => props.value;
  return (
    <Show
      when={typeof value() === "string" ? (value() as string) : undefined}
      fallback={<code>{JSON.stringify(value())}</code>}
    >
      {(text) => (
        <Show
          when={text().startsWith("https://") || text().startsWith("http://")}
          fallback={<code>{text()}</code>}
        >
          <a href={text()}>{text()}</a>
        </Show>
      )}
    </Show>
  );
}

// ===========================================================================
// WorkloadServicesSection
// ===========================================================================

function WorkloadServicesSection(props: {
  installationId: string;
  services: readonly WorkloadService[] | undefined;
  loading: boolean;
  error: unknown;
  onRotated: () => void;
}) {
  const [busyService, setBusyService] = createSignal<string | null>(null);
  const [rotation, setRotation] =
    createSignal<RotateWorkloadServiceTokenResult | null>(null);
  const [err, setErr] = createSignal<string | null>(null);

  const rotate = async (service: WorkloadService) => {
    setBusyService(service.id);
    setErr(null);
    setRotation(null);
    try {
      const result = await rpc.installations.rotateServiceToken(
        props.installationId,
        service.id,
      );
      setRotation(result);
      props.onRotated();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusyService(null);
    }
  };

  return (
    <section class="detail-section">
      <h2>Services</h2>
      <Switch>
        <Match when={props.loading}>
          <div class="skel-block" />
        </Match>
        <Match when={props.error}>
          <p class="muted">サービスを取得できませんでした。</p>
        </Match>
        <Match when={props.services}>
          {(services) => (
            <Show
              when={services().length > 0}
              fallback={<p class="muted">—</p>}
            >
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Status</th>
                    <th>Endpoint</th>
                    <th>Secret</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <For each={services()}>
                    {(service) => (
                      <tr>
                        <td>
                          <code>{service.id}</code>
                          <div class="muted">{service.materialKind}</div>
                        </td>
                        <td>{service.status}</td>
                        <td>
                          <Show when={service.endpoint} fallback={<>—</>}>
                            {(endpoint) => <OutputValue value={endpoint()} />}
                          </Show>
                        </td>
                        <td>
                          <Show when={service.secretRef} fallback={<>—</>}>
                            {(secretRef) => (
                              <>
                                <code>{secretRef()}</code>
                                <Show when={service.tokenExpiresAt}>
                                  {(expiresAt) => (
                                    <div class="muted">
                                      expires {expiresAt()}
                                    </div>
                                  )}
                                </Show>
                              </>
                            )}
                          </Show>
                        </td>
                        <td>
                          <Show when={service.rotateTokenUrl}>
                            <button
                              class="btn btn-secondary"
                              type="button"
                              disabled={busyService() === service.id}
                              onClick={() => void rotate(service)}
                            >
                              <Icons.RefreshCw class="w-4 h-4" />{" "}
                              {busyService() === service.id
                                ? "Rotating"
                                : "Rotate"}
                            </button>
                          </Show>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          )}
        </Match>
      </Switch>
      <Show when={rotation()}>
        {(result) => (
          <div class="op-card" style="margin-top: 16px;">
            <h3>
              <Icons.Key class="w-4 h-4" /> {result().service.id}
            </h3>
            <dl class="kv-list">
              <dt>Token</dt>
              <dd>
                <textarea
                  readOnly
                  rows={3}
                  value={result().token}
                  style="width: 100%;"
                />
              </dd>
              <dt>Secret ref</dt>
              <dd>
                <code>{result().service.secretRef ?? "—"}</code>
              </dd>
              <dt>Expires</dt>
              <dd>{result().expiresAt}</dd>
            </dl>
          </div>
        )}
      </Show>
      <Show when={err()}>{(m) => <p class="sign-in-error">{m()}</p>}</Show>
    </section>
  );
}

// ===========================================================================
// OidcClientSection
// ===========================================================================

function OidcClientSection(props: { client: OidcClientConfig | undefined }) {
  return (
    <section class="detail-section">
      <h2>OIDC Client</h2>
      <Show
        when={props.client}
        fallback={
          <p class="muted">この installation には OIDC client がありません。</p>
        }
      >
        {(client) => (
          <dl class="kv-list">
            <dt>Client ID</dt>
            <dd>
              <code>{client().clientId}</code>
            </dd>
            <dt>Issuer</dt>
            <dd>
              <code>{client().issuerUrl ?? "—"}</code>
            </dd>
            <dt>Service path</dt>
            <dd>
              <code>{client().servicePath ?? "—"}</code>
            </dd>
            <dt>Redirect URIs</dt>
            <dd>
              <Show
                when={(client().redirectUris ?? []).length > 0}
                fallback={<>—</>}
              >
                <For each={client().redirectUris ?? []}>
                  {(uri) => (
                    <div>
                      <code>{uri}</code>
                    </div>
                  )}
                </For>
              </Show>
            </dd>
            <dt>Allowed scopes</dt>
            <dd>{(client().allowedScopes ?? []).join(", ") || "—"}</dd>
            <dt>Subject mode</dt>
            <dd>{client().subjectMode ?? "—"}</dd>
            <dt>Token endpoint auth</dt>
            <dd>{client().tokenEndpointAuthMethod ?? "—"}</dd>
          </dl>
        )}
      </Show>
    </section>
  );
}

// ===========================================================================
// MaterializeForm
// ===========================================================================

function MaterializeForm(props: {
  installation: Installation;
  onDone: () => void;
}) {
  const [region, setRegion] = createSignal("default");
  const [costAck, setCostAck] = createSignal(false);

  const materialize = createAction(async () => {
    const updated = await rpc.installations.materialize(
      props.installation.installationId,
      { region: region(), costAck: costAck() },
    );
    props.onDone();
    return `materialize を受け付けました (status: ${updated.status ?? "?"})`;
  });
  const status = materialize.result;

  const run = (e: Event) => {
    e.preventDefault();
    materialize.clearResult();
    void materialize.run();
  };

  return (
    <div class="op-card">
      <h3>
        <Icons.Server class="w-4 h-4" /> Materialize (dedicated)
      </h3>
      <p class="muted">
        shared-cell の installation を専用セルへ昇格します。コストが発生するため
        確認が必要です。
      </p>
      <form class="install-form" onSubmit={run}>
        <label>
          Region
          <input
            type="text"
            value={region()}
            onInput={(e) => setRegion(e.currentTarget.value)}
            placeholder="default"
          />
        </label>
        <label class="op-checkbox">
          <input
            type="checkbox"
            checked={costAck()}
            onChange={(e) => setCostAck(e.currentTarget.checked)}
          />
          コスト発生を承認する (cost acknowledgement)
        </label>
        <button
          class="btn btn-primary"
          type="submit"
          disabled={materialize.busy() || !costAck()}
        >
          <Icons.Server class="w-4 h-4" />{" "}
          {materialize.busy() ? "Materialize 中..." : "Materialize"}
        </button>
      </form>
      <Show when={status()}>
        {(m) => (
          <p class="muted" style="margin-top: 8px;">
            {m()}
          </p>
        )}
      </Show>
      <ActionError error={materialize.error} />
    </div>
  );
}

// ===========================================================================
// ExportForm
// ===========================================================================

const EXPORT_POLL_ATTEMPTS = 12;
const EXPORT_POLL_INTERVAL_MS = 1500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ExportForm(props: { installationId: string }) {
  const [includeData, setIncludeData] = createSignal(false);
  const [encryptionMethod, setEncryptionMethod] = createSignal("none");
  const [recipients, setRecipients] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [operation, setOperation] = createSignal<ExportOperation | null>(null);
  const [err, setErr] = createSignal<string | null>(null);

  const downloadHref = () => {
    const op = operation();
    if (!op || op.status !== "exported") return null;
    return (
      op.downloadUrl ??
      rpc.installations.exportDownloadUrl(props.installationId, op.operationId)
    );
  };

  const run = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setOperation(null);
    try {
      const recipientList = recipients()
        .split(/\r?\n|,/)
        .map((r) => r.trim())
        .filter((r) => r.length > 0);
      let op = await rpc.installations.requestExport(props.installationId, {
        includeData: includeData(),
        encryptionMethod: encryptionMethod(),
        recipients: recipientList,
      });
      setOperation(op);
      // Poll the operation until it leaves the "preparing" state (or we give up).
      for (
        let attempt = 0;
        attempt < EXPORT_POLL_ATTEMPTS && op.status === "preparing";
        attempt++
      ) {
        await delay(EXPORT_POLL_INTERVAL_MS);
        op = await rpc.installations.getExportOperation(
          props.installationId,
          op.operationId,
        );
        setOperation(op);
      }
      if (op.status === "failed") {
        setErr(op.error ?? "export に失敗しました。");
      }
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="op-card">
      <h3>
        <Icons.Download class="w-4 h-4" /> Export
      </h3>
      <p class="muted">
        installation のエクスポートバンドルを作成します。完了するとダウンロード
        リンクが表示されます。
      </p>
      <form class="install-form" onSubmit={run}>
        <label class="op-checkbox">
          <input
            type="checkbox"
            checked={includeData()}
            onChange={(e) => setIncludeData(e.currentTarget.checked)}
          />
          データを含める (include data)
        </label>
        <label>
          Encryption
          <select
            value={encryptionMethod()}
            onChange={(e) => setEncryptionMethod(e.currentTarget.value)}
          >
            <option value="none">none</option>
            <option value="age">age</option>
          </select>
        </label>
        <Show when={encryptionMethod() !== "none"}>
          <label>
            Recipients (1 行に 1 つ / カンマ区切り)
            <textarea
              value={recipients()}
              onInput={(e) => setRecipients(e.currentTarget.value)}
              placeholder="age1..."
              rows={3}
            />
          </label>
        </Show>
        <button class="btn btn-secondary" type="submit" disabled={busy()}>
          <Icons.Download class="w-4 h-4" /> {busy() ? "Export 中..." : "Export"}
        </button>
      </form>
      <Show when={operation()}>
        {(op) => (
          <p class="muted" style="margin-top: 8px;">
            operation <code>{op().operationId}</code> — status:{" "}
            <strong>{op().status}</strong>
          </p>
        )}
      </Show>
      <Show when={downloadHref()}>
        {(href) => (
          <a class="btn btn-primary" href={href()} style="margin-top: 8px;">
            <Icons.Download class="w-4 h-4" /> ダウンロード
          </a>
        )}
      </Show>
      <Show when={err()}>{(m) => <p class="sign-in-error">{m()}</p>}</Show>
    </div>
  );
}

// ===========================================================================
// EventsSection
// ===========================================================================

function shortHash(hash: string | undefined): string {
  if (!hash) return "—";
  const body = hash.startsWith("sha256:") ? hash.slice("sha256:".length) : hash;
  return body.length > 16 ? `${body.slice(0, 16)}…` : body;
}

function EventsSection(props: { installationId: string }) {
  const [events] = createResource(
    () => props.installationId,
    (id) => rpc.installations.events(id, { limit: 50 }),
  );
  return (
    <section class="detail-section">
      <h2>Events</h2>
      <Switch>
        <Match when={events.loading}>
          <div class="skel-block" />
        </Match>
        <Match when={events.error}>
          <p class="muted">イベントを取得できませんでした。</p>
        </Match>
        <Match when={events()}>
          {(result) => (
            <Show
              when={result().events.length > 0}
              fallback={<p class="muted">まだイベントはありません。</p>}
            >
              <p class="muted">
                hash chain:{" "}
                <strong>{result().hashChainValid ? "valid" : "invalid"}</strong>
              </p>
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Created</th>
                    <th>Event hash</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={result().events}>
                    {(event) => (
                      <tr>
                        <td>{event.type}</td>
                        <td>{event.createdAt ?? "—"}</td>
                        <td>
                          <code>{shortHash(event.eventHash)}</code>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          )}
        </Match>
      </Switch>
    </section>
  );
}

// ===========================================================================
// Launch state helper (ported from lib/app-launch.ts + use-takos-start.ts)
// ===========================================================================

interface AppDetailLaunchState {
  readonly label: string;
  readonly description: string;
  readonly href?: string;
}

interface AppDetailLaunchEnvironment {
  readonly origin: string;
  readonly hostname: string;
}

function appDetailLaunchState(
  app: Installation,
  env: AppDetailLaunchEnvironment,
): AppDetailLaunchState {
  if (app.status !== "ready") return unavailableLaunchState(app.status);

  if (app.launchUrl) {
    return {
      label: "Launch app",
      href: app.launchUrl,
      description: "This Installation exposes a Cloud launch URL.",
    };
  }

  if (isManagedTakosInstallation(app)) {
    if (!app.accountId || !app.spaceId || !app.installationId) {
      return {
        label: "Launch unavailable",
        description:
          "Takos launch requires account, space, and installation identifiers.",
      };
    }
    const href = managedTakosLaunchUrl(app, env);
    if (!href) {
      return {
        label: "Launch unavailable",
        description:
          "This Installation is ready, but no Takos host is configured for this distribution.",
      };
    }
    return {
      label: "Launch Takos",
      href,
      description:
        "Takos launch issues a short-lived launch token from this account-plane Installation.",
    };
  }

  return {
    label: "Launch unavailable",
    description:
      "This Installation is ready, but no Cloud launch entry is configured.",
  };
}

function isManagedTakosInstallation(app: Installation): boolean {
  return (
    app.appId === "takos.chat" ||
    app.sourceGitUrl === "takos-product://managed/takos"
  );
}

function managedTakosLaunchUrl(
  app: Installation,
  env: AppDetailLaunchEnvironment,
): string | undefined {
  const takosUrl = tryDefaultTakosUrlForHost(env.hostname);
  if (!takosUrl) return undefined;
  if (!app.spaceId) return undefined;
  const url = new URL("/takos/start", env.origin);
  url.searchParams.set("takos_url", takosUrl);
  url.searchParams.set("account_id", app.accountId ?? "");
  url.searchParams.set("space_id", app.spaceId ?? "");
  url.searchParams.set("installation_id", app.installationId);
  url.searchParams.set("app_id", app.appId || "takos.chat");
  url.searchParams.set("return_to", `/spaces/${app.spaceId}/threads`);
  return url.toString();
}

function tryDefaultTakosUrlForHost(hostname: string): string | undefined {
  if (isLocalHost(hostname)) return "https://takos.test";
  const configured = readTakosUrlEnv();
  if (configured) return configured;
  return undefined;
}

function readTakosUrlEnv(): string | undefined {
  try {
    const meta = import.meta as unknown as {
      env?: { readonly VITE_TAKOSUMI_DASHBOARD_TAKOS_URL?: string };
    };
    return meta.env?.VITE_TAKOSUMI_DASHBOARD_TAKOS_URL?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname.endsWith(".test") ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}

function unavailableLaunchState(
  status: Installation["status"],
): AppDetailLaunchState {
  switch (status) {
    case "installing":
      return {
        label: "Launch unavailable",
        description:
          "Installation is still preparing. Launch becomes available after it is ready.",
      };
    case "failed":
      return {
        label: "Launch unavailable",
        description: "Installation failed. Resolve the failure before launch.",
      };
    case "suspended":
      return {
        label: "Launch unavailable",
        description:
          "Installation is suspended. Resolve the account or billing action before launch.",
      };
    case "exported":
      return {
        label: "Launch unavailable",
        description: "Installation was exported and cannot be launched here.",
      };
    default:
      return {
        label: "Launch unavailable",
        description:
          "Installation status is unknown. Launch is disabled until status is ready.",
      };
  }
}
