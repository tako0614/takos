/** Deep link into Takosumi Cloud's install wizard with this repo pre-filled. */
const FALLBACK = 'https://cloud.takosumi.com/apps/install' +
  '?git=' + encodeURIComponent('https://github.com/tako0614/takos.git') +
  '&ref=main&mode=shared-cell&autodryrun=1';

const LOCAL_FALLBACK = FALLBACK.replace(
  'cloud.takosumi.com',
  'cloud.takosumi.test',
);

export function resolveCloudInstallUrl(hostname = browserHostname()): string {
  const configured = import.meta.env.VITE_CLOUD_INSTALL_URL as
    | string
    | undefined;
  if (configured) return configured;
  return isLocalSubstrateHost(hostname) ? LOCAL_FALLBACK : FALLBACK;
}

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
