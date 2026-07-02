import type { JSX } from 'solid-js';
import type { Locale } from '~/content/site';
import { SITE } from '~/content/site';
import { localeUrl } from '~/lib/i18n';

/**
 * Structured data for richer search results. Rendered as an `application/ld+json`
 * data block (not executable, so allowed under `script-src 'self'`).
 */
export default function JsonLd(props: { locale: Locale }): JSX.Element {
  const m = SITE[props.locale].meta;
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': 'https://takos.jp/#org',
        name: 'Takos',
        url: 'https://takos.jp/',
        logo: 'https://takos.jp/logo.png',
        sameAs: ['https://github.com/tako0614/takos'],
      },
      {
        '@type': 'SoftwareApplication',
        '@id': 'https://takos.jp/#app',
        name: 'Takos',
        applicationCategory: 'CommunicationApplication',
        operatingSystem: 'Self-hostable (Cloudflare, AWS, GCP, Kubernetes, VM)',
        url: localeUrl(props.locale),
        description: m.description,
        license: 'https://www.gnu.org/licenses/agpl-3.0.html',
        isAccessibleForFree: true,
        codeRepository: 'https://github.com/tako0614/takos',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        publisher: { '@id': 'https://takos.jp/#org' },
      },
    ],
  };
  return <script type='application/ld+json' innerHTML={JSON.stringify(data)} />;
}
