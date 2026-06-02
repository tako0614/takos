// @refresh reload
import { createHandler, StartServer } from '@solidjs/start/server';

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang='ja'>
        <head>
          <meta charset='utf-8' />
          <meta name='viewport' content='width=device-width, initial-scale=1' />
          <link rel='icon' href='/brand/favicon.svg' />
          <link rel='apple-touch-icon' href='/brand/favicon.svg' />
          {/* Render-blocking, CSP-safe (script-src 'self'): restores theme +
              marks JS-enabled before first paint to avoid FOUC. */}
          <script src='/theme-init.js'></script>
          {assets}
        </head>
        <body>
          <div id='app'>{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));
