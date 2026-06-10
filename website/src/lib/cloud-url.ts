// The Takosumi platform worker hosts every public surface (account-plane,
// install wizard, dashboard) on its bare origin: app.takosumi.com in
// production, app.takosumi.test in local-substrate. There is no separate
// "accounts." subdomain. The install wizard takes only the well-known
// OpenTofu deep-link params git / ref / autoplan.
const PLATFORM_HOST = 'app.takosumi.com';
const LOCAL_PLATFORM_HOST = 'app.takosumi.test';

const TAKOS_GIT_URL = 'https://github.com/tako0614/takos.git';

function installUrl(host: string): string {
  const url = new URL(`https://${host}/install`);
  url.searchParams.set('git', TAKOS_GIT_URL);
  url.searchParams.set('ref', 'main');
  url.searchParams.set('autoplan', '1');
  return url.toString();
}

/** Takosumi dashboard home on the platform worker. */
const CLOUD_HOME_FALLBACK = `https://${PLATFORM_HOST}/`;
const LOCAL_CLOUD_HOME_FALLBACK = `https://${LOCAL_PLATFORM_HOST}/`;

/**
 * Anyone — everyday user or developer — lands on the same Takosumi install
 * wizard: open app.takosumi.com/install?git=<repo>&ref=main&autoplan=1 and
 * Takosumi pre-fills the wizard and runs the plan. Takos is just one such repo.
 */
const INSTALL_FALLBACK = installUrl(PLATFORM_HOST);
const LOCAL_INSTALL_FALLBACK = installUrl(LOCAL_PLATFORM_HOST);

// "Use Takos" (the everyday-user entry) lands on the same working install
// wizard so the CTA is never a dead host.
const USE_TAKOS_FALLBACK = INSTALL_FALLBACK;
const LOCAL_USE_TAKOS_FALLBACK = LOCAL_INSTALL_FALLBACK;

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
  return isLocalSubstrateHost(hostname) ? LOCAL_CLOUD_HOME_FALLBACK : CLOUD_HOME_FALLBACK;
}

export function resolveCloudUseTakosUrl(hostname = browserHostname()): string {
  const configured = import.meta.env.VITE_CLOUD_USE_TAKOS_URL as
    | string
    | undefined;
  if (configured) return configured;
  return isLocalSubstrateHost(hostname) ? LOCAL_USE_TAKOS_FALLBACK : USE_TAKOS_FALLBACK;
}

export function resolveCloudInstallUrl(hostname = browserHostname()): string {
  const configured = import.meta.env.VITE_CLOUD_INSTALL_URL as
    | string
    | undefined;
  if (configured) return configured;
  return isLocalSubstrateHost(hostname) ? LOCAL_INSTALL_FALLBACK : INSTALL_FALLBACK;
}

function browserHostname(): string {
  return typeof location === 'undefined' ? '' : location.hostname;
}

function isLocalSubstrateHost(hostname: string): boolean {
  return hostname.endsWith('.test') ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1';
}
