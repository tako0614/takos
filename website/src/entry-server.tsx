// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="ja">
        <head>
          <meta charset="utf-8" />
          <meta name="adring-site-verification" content="adring_vrf_tqjNuQemCMN6ZUe9kOJCjmPJ4_-hA4Qv" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          {/* title / description / OG / Twitter / canonical are emitted per
              locale by <Seo>; duplicating them here produced two <title> and
              two description tags in the prerendered HTML. */}
          <link rel="icon" href="/logo.png" />
          <link rel="apple-touch-icon" href="/logo.png" />
          {/* Render-blocking, CSP-safe (script-src 'self'): restores theme +
              marks JS-enabled before first paint to avoid FOUC. */}
          <script src="/theme-init.js"></script>
          {assets}
        </head>
        <body>
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));
