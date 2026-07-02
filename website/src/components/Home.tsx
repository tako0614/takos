import type { JSX } from 'solid-js';
import type { Locale } from '~/content/site';
import { LocaleProvider } from '~/lib/i18n';
import { CloudProvider } from '~/lib/cloud';
import SplatField from './SplatField';
import Seo from './Seo';
import JsonLd from './JsonLd';
import Nav from './Nav';
import Hero from './Hero';
import Why from './Why';
import Showcase from './Showcase';
import BundledApps from './BundledApps';
import Comparison from './Comparison';
import InstallCTA from './InstallCTA';
import Footer from './Footer';

/** The full landing page, rendered once per locale by the route shells. */
export default function Home(props: { locale: Locale }): JSX.Element {
  return (
    <LocaleProvider locale={props.locale}>
      <CloudProvider>
        <Seo locale={props.locale} />
        <Nav />
        <main>
          <Hero />
          <div class='ink-canvas'>
            <SplatField density='page' />
            <Why />
            <Showcase />
            <BundledApps />
            <Comparison />
            <InstallCTA />
          </div>
        </main>
        <Footer />
        <JsonLd locale={props.locale} />
      </CloudProvider>
    </LocaleProvider>
  );
}
