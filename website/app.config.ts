import { defineConfig } from '@solidjs/start/config';

export default defineConfig({
  // Static prerender for landing — no runtime needed; Cloudflare Pages
  // (and the local-substrate Caddy file_server) serve the dist/ as is.
  server: {
    preset: 'static',
    prerender: {
      // landing は ja (`/`) と en (`/en/`) の 2 route。 docs/cloud などへの
      // 外向き link は同一 origin の別 server (Caddy handle_path /docs/* で別
      // root に route) が serve する。 crawler に追わせると fallback HTML が
      // .output/public/docs/ 配下に出来てしまうので無効化し、route は明示する。
      crawlLinks: false,
      routes: ['/', '/en'],
    },
  },
});
