// Force undici (Node's fetch) to prefer IPv4.
//
// Some environments have broken/blocked IPv6 egress. When undici's connection
// attempts prefer IPv6, requests can time out (e.g. wrangler auth against
// dash.cloudflare.com). Requiring this file before running wrangler avoids the
// timeout by pinning undici to IPv4.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { setGlobalDispatcher, Agent } = require('undici');
  setGlobalDispatcher(new Agent({ connect: { family: 4 } }));
} catch {
  // Ignore if undici is unavailable for some reason.
}

