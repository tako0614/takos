/** Deep link into Takosumi Cloud's Use Takos account-plane entry. */
const USE_TAKOS_FALLBACK = 'https://cloud.takosumi.com/dashboard/use-takos' +
  '?takos_url=' + encodeURIComponent('https://takos.jp');

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

export const CLOUD_USE_TAKOS_URL: string = resolveCloudUseTakosUrl();
export const CLOUD_INSTALL_URL: string = resolveCloudInstallUrl();

function browserHostname(): string {
  return typeof location === 'undefined' ? '' : location.hostname;
}

function isLocalSubstrateHost(hostname: string): boolean {
  return hostname.endsWith('.test') ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1';
}
