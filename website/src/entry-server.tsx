// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="ja">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Takos — AI-first chat & agent, your own server.</title>
          <meta
            name="description"
            content="Takos is a self-hostable AI-first chat and agent workspace. Use Takosumi to install the pinned OpenTofu Capsule from Git, review the plan, and keep your data on your own server."
          />
          <meta property="og:site_name" content="Takos" />
          <meta
            property="og:title"
            content="Takos — AI-first chat & agent, your own server."
          />
          <meta
            property="og:description"
            content="A self-hostable AI chat and agent workspace with memory, Git, apps, and a Takosumi install path for a reviewed OpenTofu deploy."
          />
          <meta property="og:url" content="https://takos.jp/" />
          <meta property="og:type" content="website" />
          <meta property="og:image" content="https://takos.jp/brand/og.png" />
          <meta name="twitter:card" content="summary_large_image" />
          <link rel="icon" href="/brand/favicon.svg" />
          <link rel="apple-touch-icon" href="/brand/favicon.svg" />
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
