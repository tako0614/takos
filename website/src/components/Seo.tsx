import { Link, Meta, Title } from '@solidjs/meta';
import type { JSX } from 'solid-js';
import type { Locale } from '~/content/site';
import { SITE } from '~/content/site';
import { localeUrl } from '~/lib/i18n';

// Raster PNG (1200×630) — social platforms (Twitter/Slack/Discord) don't render SVG OG images.
const OG_IMAGE = 'https://takos.jp/brand/og.png';

/**
 * Per-locale document metadata: title, description, Open Graph, Twitter card,
 * canonical, and hreflang alternates. JSON-LD lives in <JsonLd> (rendered in
 * the page body, which Google accepts and CSP allows for ld+json data blocks).
 */
export default function Seo(props: { locale: Locale }): JSX.Element {
  const m = SITE[props.locale].meta;
  const isJa = props.locale === 'ja';
  return (
    <>
      <Title>{m.title}</Title>
      <Meta name='description' content={m.description} />
      <Link rel='canonical' href={localeUrl(props.locale)} />
      <Link rel='alternate' hreflang='ja' href={localeUrl('ja')} />
      <Link rel='alternate' hreflang='en' href={localeUrl('en')} />
      <Link rel='alternate' hreflang='x-default' href={localeUrl('ja')} />

      <Meta property='og:title' content={m.ogTitle} />
      <Meta property='og:description' content={m.ogDescription} />
      <Meta property='og:url' content={localeUrl(props.locale)} />
      <Meta property='og:type' content='website' />
      <Meta property='og:site_name' content='Takos' />
      <Meta property='og:locale' content={isJa ? 'ja_JP' : 'en_US'} />
      <Meta property='og:locale:alternate' content={isJa ? 'en_US' : 'ja_JP'} />
      <Meta property='og:image' content={OG_IMAGE} />
      <Meta property='og:image:alt' content='Takos — AI-first chat & agent, your own server.' />

      <Meta name='twitter:card' content='summary_large_image' />
      <Meta name='twitter:title' content={m.ogTitle} />
      <Meta name='twitter:description' content={m.ogDescription} />
      <Meta name='twitter:image' content={OG_IMAGE} />

      <Meta name='theme-color' content='#0a0a0a' />
    </>
  );
}
