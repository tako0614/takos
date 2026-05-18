import { Meta, Title } from '@solidjs/meta';
import Nav from '~/components/Nav';
import Hero from '~/components/Hero';
import FeatureGrid from '~/components/FeatureGrid';
import BundledApps from '~/components/BundledApps';
import InstallCTA from '~/components/InstallCTA';
import Footer from '~/components/Footer';

export default function Home() {
  return (
    <>
      <Title>Takos — AI-first chat & agent, your own server.</Title>
      <Meta
        name='description'
        content='Self-hostable な AI-first chat & agent product。 chat / agent / memory / space を core に持ち、 docs / slide / excel / social などの bundled apps が auto-install される。 Takosumi PaaS の上で動くので Cloudflare / AWS / 自前 VM どこでも install できる。'
      />
      <Meta property='og:title' content='Takos — AI-first chat & agent, your own server.' />
      <Meta
        property='og:description'
        content='AI-first chat product。 1-click で Takosumi Cloud に install、 自前 substrate にも .takosumi.yml AppSpec で install。'
      />
      <Meta property='og:url' content='https://takos.jp/' />
      <Meta property='og:type' content='website' />
      <Meta property='og:image' content='https://takos.jp/brand/geometric.svg' />

      <Nav />
      <main>
        <Hero />
        <FeatureGrid />
        <BundledApps />
        <InstallCTA />
      </main>
      <Footer />
    </>
  );
}
