// The Takosumi platform worker hosts every public surface (account-plane,
// dashboard, and dashboard-owned install prefill entrypoint) on its bare
// origin: app.takosumi.com in production, app.takosumi.test in
// local-substrate. There is no separate "accounts." subdomain. The add flow
// reads only the well-known OpenTofu deep-link params git / ref / path.
const PLATFORM_HOST = "app.takosumi.com";
const LOCAL_PLATFORM_HOST = "app.takosumi.test";

const DEFAULT_TAKOS_GIT_URL = "https://github.com/tako0614/takos.git";
// Takos ships as an OpenTofu Capsule under deploy/opentofu; the deep link
// points the install wizard at that module path inside the repo so the Capsule
// resolves to the module root rather than the repo root.
// Fallback must be immutable because takos.jp can be built without operator
// env overrides. Release builds should still set VITE_TAKOS_INSTALL_REF to the
// release tag, but the source fallback must never publish a moving ref.
const DEFAULT_TAKOS_REF = "9d43896d6bd0dd0a59ed4fb72e9f25151af06ad2";
const DEFAULT_TAKOS_MODULE_PATH = "deploy/opentofu";

function installUrl(host: string): string {
  const url = new URL(`https://${host}/install`);
  url.searchParams.set("git", takosInstallGitUrl());
  url.searchParams.set("ref", takosInstallRef());
  url.searchParams.set("path", takosInstallModulePath());
  return url.toString();
}

/** Takosumi dashboard home on the platform worker. */
const CLOUD_HOME_FALLBACK = `https://${PLATFORM_HOST}/`;
const LOCAL_CLOUD_HOME_FALLBACK = `https://${LOCAL_PLATFORM_HOST}/`;

/**
 * Git/install links land on the Takosumi add flow:
 * app.takosumi.com/install?git=<repo>&ref=<tag-or-commit>&path=<module>
 * pre-fills `/new` with the repo coordinates. The visitor reviews the Capsule
 * compatibility result and explicitly creates/plans there.
 */
const INSTALL_FALLBACK = installUrl(PLATFORM_HOST);
const LOCAL_INSTALL_FALLBACK = installUrl(LOCAL_PLATFORM_HOST);

// "Use Takos" is the everyday-user entry. It should land on the account/home
// surface, not the Git Capsule install wizard. "Install from Git" is the
// explicit Git URL path below.
const USE_TAKOS_FALLBACK = CLOUD_HOME_FALLBACK;
const LOCAL_USE_TAKOS_FALLBACK = LOCAL_CLOUD_HOME_FALLBACK;

export interface CloudUrls {
  readonly home: string;
  readonly useTakos: string;
  readonly install: string;
}

export function resolveCloudUrls(hostname = browserHostname()): CloudUrls {
  return {
    home: resolveCloudHomeUrl(hostname),
    useTakos: resolveCloudUseTakosUrl(hostname),
    install: resolveCloudInstallUrl(hostname),
  };
}

export function resolveCloudHomeUrl(hostname = browserHostname()): string {
  const configured = import.meta.env.VITE_CLOUD_HOME_URL as string | undefined;
  if (configured) return configured;
  return isLocalSubstrateHost(hostname)
    ? LOCAL_CLOUD_HOME_FALLBACK
    : CLOUD_HOME_FALLBACK;
}

export function resolveCloudUseTakosUrl(hostname = browserHostname()): string {
  const configured = import.meta.env.VITE_CLOUD_USE_TAKOS_URL as
    | string
    | undefined;
  if (configured) return configured;
  return isLocalSubstrateHost(hostname)
    ? LOCAL_USE_TAKOS_FALLBACK
    : USE_TAKOS_FALLBACK;
}

export function resolveCloudInstallUrl(hostname = browserHostname()): string {
  const configured = import.meta.env.VITE_CLOUD_INSTALL_URL as
    | string
    | undefined;
  if (configured) return configured;
  return isLocalSubstrateHost(hostname)
    ? LOCAL_INSTALL_FALLBACK
    : INSTALL_FALLBACK;
}

function takosInstallGitUrl(): string {
  return envString("VITE_TAKOS_INSTALL_GIT_URL") ?? DEFAULT_TAKOS_GIT_URL;
}

function takosInstallRef(): string {
  return envString("VITE_TAKOS_INSTALL_REF") ?? DEFAULT_TAKOS_REF;
}

function takosInstallModulePath(): string {
  return (
    envString("VITE_TAKOS_INSTALL_MODULE_PATH") ?? DEFAULT_TAKOS_MODULE_PATH
  );
}

function envString(key: string): string | undefined {
  const value = import.meta.env[key] as string | undefined;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function browserHostname(): string {
  return typeof location === "undefined" ? "" : location.hostname;
}

function isLocalSubstrateHost(hostname: string): boolean {
  return (
    hostname.endsWith(".test") ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}
