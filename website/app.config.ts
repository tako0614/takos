import { defineConfig } from "@solidjs/start/config";

export default defineConfig({
  // Static prerender for landing — no runtime needed; Cloudflare Pages
  // (and the local-substrate Caddy file_server) serve the dist/ as is.
  server: {
    preset: "static",
    prerender: {
      // landing は 1 page で、 docs/cloud などへの外向き link は
      // 同一 origin の別 server (Caddy handle_path /docs/* で別 root に
      // route) が serve する。 crawler に追わせると fallback HTML が
      // .output/public/docs/ 配下に出来てしまうので無効化。
      crawlLinks: false,
      routes: ["/"],
    },
  },
});
