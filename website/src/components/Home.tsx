import type { JSX } from 'solid-js';
import type { Locale } from '~/content/site';
import { LocaleProvider } from '~/lib/i18n';
import { CloudProvider } from '~/lib/cloud';
import Seo from './Seo';
import JsonLd from './JsonLd';
import Nav from './Nav';
import Head from './Head';
import Stations from './Stations';
import BundledApps from './BundledApps';
import Data from './Data';
import InstallCTA from './InstallCTA';
import Footer from './Footer';
import AdringWidget from './AdringWidget';

/** The full document page, rendered once per locale by the route shells. */
export default function Home(props: { locale: Locale }): JSX.Element {
  return (
    <LocaleProvider locale={props.locale}>
      <CloudProvider>
        <Seo locale={props.locale} />
        <Nav />
        <main>
          <Head />
          <Stations />
          <BundledApps />
          <Data />
          <InstallCTA />
          <div class='ad-slot'>
            <AdringWidget />
          </div>
        </main>
        <Footer />
        <JsonLd locale={props.locale} />
      </CloudProvider>
    </LocaleProvider>
  );
}
