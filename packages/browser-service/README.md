# takos-browser-service

Hono-based HTTP service wrapping Playwright for headless browser automation.
Manages the full browser lifecycle -- launching a persistent Chromium context,
navigating pages, performing DOM interactions, extracting content, capturing
screenshots/PDFs, and managing multiple tabs.

## Architecture

```
src/
  index.ts              -- re-exports from app.ts
  app.ts                -- Hono HTTP app factory + standalone server entrypoint
  browser-manager.ts    -- BrowserManager class (Playwright lifecycle + actions)
```

### BrowserManager

The core class that wraps Playwright's persistent Chromium context:

- **Lifecycle**: `bootstrap()` launches a headless Chromium instance with a
  persistent profile at `/tmp/browser-profile`. `close()` tears it down.
- **Navigation**: `goto()` navigates the active page with configurable
  `waitUntil` and timeout.
- **Actions**: `action()` dispatches typed browser actions (click, type, scroll,
  select, hover, press, check, uncheck, focus, clear) via a type-safe handler
  map.
- **Extraction**: `extract()` retrieves DOM content by CSS selector or
  arbitrary `page.evaluate()` JavaScript.
- **Capture**: `screenshot()` returns a PNG buffer; `pdf()` returns an A4 PDF.
- **Tabs**: `tabs()`, `newTab()`, `closeTab()`, `switchTab()` for multi-tab
  management. The active page is tracked and updated automatically.

### HTTP Service

`createBrowserServiceApp()` builds a Hono app that exposes the BrowserManager
over HTTP. `startBrowserService()` additionally binds to a port with graceful
shutdown on SIGTERM/SIGINT.

All navigation URLs are validated to prevent SSRF -- localhost, private IPs,
non-HTTP protocols, and embedded credentials are rejected.

## API Endpoints

All endpoints are under the `/internal/` prefix.

| Method | Path | Description |
|---|---|---|
| `GET` | `/internal/healthz` | Health check (returns browser alive status) |
| `POST` | `/internal/bootstrap` | Launch browser, optionally navigate to URL |
| `POST` | `/internal/goto` | Navigate active page to URL |
| `POST` | `/internal/action` | Execute a browser action (click, type, etc.) |
| `POST` | `/internal/extract` | Extract content via selector or JS evaluate |
| `GET` | `/internal/html` | Get full HTML content of active page |
| `GET` | `/internal/screenshot` | Capture PNG screenshot of active page |
| `POST` | `/internal/pdf` | Generate A4 PDF of active page |
| `GET` | `/internal/tabs` | List all open tabs with URLs and titles |
| `POST` | `/internal/tab/new` | Open a new tab, optionally with a URL |
| `POST` | `/internal/tab/close` | Close tab by index |
| `POST` | `/internal/tab/switch` | Switch active tab by index |

## Key Exports

| Export | Description |
|---|---|
| `createBrowserServiceApp(options?)` | Create Hono app + BrowserManager (no server binding) |
| `startBrowserService(options?)` | Create app and start Deno HTTP server |
| `BrowserManager` | Class managing Playwright browser lifecycle and actions |

### Types

| Type | Description |
|---|---|
| `BrowserServiceOptions` | Service config: `port`, `shutdownGraceMs`, `serviceName` |
| `BrowserAction` | Discriminated union of all browser action types |
| `BootstrapPayload` | Bootstrap request: optional `url` and `viewport` |
| `GotoPayload` | Navigation request: `url`, `waitUntil`, `timeout` |
| `ExtractPayload` | Extraction request: `selector` or `evaluate` |

## Browser Actions

The `BrowserAction` type is a discriminated union on the `type` field:

| Action | Fields | Description |
|---|---|---|
| `click` | `selector`, `button?`, `clickCount?` | Click an element |
| `type` | `selector`, `text`, `delay?` | Fill text into an input |
| `scroll` | `direction`, `amount?`, `selector?` | Scroll page or element |
| `select` | `selector`, `value` | Select option in dropdown |
| `hover` | `selector` | Hover over element |
| `press` | `key`, `modifiers?` | Press keyboard key with optional modifiers |
| `check` | `selector` | Check a checkbox |
| `uncheck` | `selector` | Uncheck a checkbox |
| `focus` | `selector` | Focus an element |
| `clear` | `selector` | Clear input field content |

## Security

- Navigation URLs are validated before every `goto` or `bootstrap` call
- Blocked: `localhost`, private/internal IPs, non-HTTP(S) protocols, embedded
  credentials
- Uses `isLocalhost()` and `isPrivateIP()` from `takos-common/validation`

## Configuration

| Env Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP server port |
| `SHUTDOWN_GRACE_MS` | `15000` | Graceful shutdown timeout |

## Dependencies

- `hono` -- HTTP framework
- `playwright-core` -- Browser automation
- `takos-common` -- Logger, env parsing, validation

## Commands

```bash
cd takos && deno run --allow-all packages/browser-service/src/app.ts
cd takos && deno test --allow-all packages/browser-service/src/
```
