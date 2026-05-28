/** Deep link into Takosumi Cloud's Use Takos account-plane entry. */
const USE_TAKOS_FALLBACK = 'https://cloud.takosumi.com/dashboard/use-takos' +
  '?takos_url=' + encodeURIComponent('https://takos.jp');

/** Takosumi Cloud dashboard home. */
const CLOUD_HOME_FALLBACK = 'https://cloud.takosumi.com/';

/** Deep link into Takosumi Cloud's install wizard with this repo pre-filled. */
const INSTALL_FALLBACK = 'https://cloud.takosumi.com/apps/install' +
  '?git=' + encodeURIComponent('https://github.com/tako0614/takos.git') +
  '&ref=main&mode=shared-cell&autodryrun=1';

const LOCAL_USE_TAKOS_FALLBACK = USE_TAKOS_FALLBACK
  .replace('cloud.takosumi.com', 'cloud.takosumi.test')
  .replace(
    encodeURIComponent('https://takos.jp'),
    encodeURIComponent('https://takos.test'),
  );

const LOCAL_INSTALL_FALLBACK = INSTALL_FALLBACK.replace(
  'cloud.takosumi.com',
  'cloud.takosumi.test',
);

const LOCAL_CLOUD_HOME_FALLBACK = CLOUD_HOME_FALLBACK.replace(
  'cloud.takosumi.com',
  'cloud.takosumi.test',
);

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
