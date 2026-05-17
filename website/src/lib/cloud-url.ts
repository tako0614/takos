/** Deep link into Takosumi Cloud's install wizard with this repo pre-filled.
 *  In local-substrate testing, override with VITE_CLOUD_INSTALL_URL at build
 *  time to point at cloud.takosumi.test instead. */
const FALLBACK = 'https://cloud.takosumi.com/apps/install' +
  '?git=' + encodeURIComponent('https://github.com/tako0614/takos.git') +
  '&ref=main&mode=shared-cell&autopreview=1';

export const CLOUD_INSTALL_URL: string = (import.meta.env.VITE_CLOUD_INSTALL_URL as string | undefined) ?? FALLBACK;
