import type { JSX } from 'solid-js';
import type { Locale } from '~/content/site';
import { LocaleProvider } from '~/lib/i18n';
import { CloudProvider } from '~/lib/cloud';
import Seo from './Seo';
import JsonLd from './JsonLd';
import Nav from './Nav';
import Head from './Head';
import Run from './Run';
import Workspace from './Workspace';
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
          <Run />
          <Workspace />
          <BundledApps />
          <Data />
          <InstallCTA />
        </main>
        <Footer />
        <AdringWidget />
        <JsonLd locale={props.locale} />
      </CloudProvider>
    </LocaleProvider>
  );
}

