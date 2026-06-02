import type { JSX } from 'solid-js';
import type { Locale } from '~/content/site';
import { LocaleProvider } from '~/lib/i18n';
import { CloudProvider } from '~/lib/cloud';
import Seo from './Seo';
import JsonLd from './JsonLd';
import Nav from './Nav';
import Hero from './Hero';
import Why from './Why';
import Pillars from './Pillars';
import FeatureGrid from './FeatureGrid';
import BundledApps from './BundledApps';
import Stats from './Stats';
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
          <Why />
          <Pillars />
          <FeatureGrid />
          <BundledApps />
          <Stats />
          <Comparison />
          <InstallCTA />
        </main>
        <Footer />
        <JsonLd locale={props.locale} />
      </CloudProvider>
    </LocaleProvider>
  );
}
