/**
 * Minimal OAuth 2.0 + OIDC mock server for local-substrate.
 *
 * Stands in for accounts.google.com / github.com so the cloud SPA's sign-in
 * flow can complete end-to-end without external network. Auto-approves every
 * /authorize request and returns deterministic user info from /userinfo.
 *
 * Two providers are served from one process under separate path prefixes:
 *   /google/{authorize,token,userinfo}   — claim shape: {sub, email, name}
 *   /github/{authorize,access_token,user} — claim shape: {id, login, email}
 *
 * Wire env (worker → mock, via Caddy TLS):
 *   TAKOSUMI_ACCOUNTS_UPSTREAM_GOOGLE_AUTHORIZATION_ENDPOINT=https://oauth-mock.test/google/authorize
 *   TAKOSUMI_ACCOUNTS_UPSTREAM_GOOGLE_TOKEN_ENDPOINT=https://oauth-mock.test/google/token
 *   TAKOSUMI_ACCOUNTS_UPSTREAM_GOOGLE_USERINFO_ENDPOINT=https://oauth-mock.test/google/userinfo
 *   TAKOSUMI_ACCOUNTS_UPSTREAM_GOOGLE_ISSUER=https://oauth-mock.test/google
 *   (same for GITHUB)
 */

const PORT = Number(Deno.env.get('PORT') ?? '8789');

interface Provider {
  readonly id: 'google' | 'github';
  readonly userInfo: () => Record<string, unknown>;
}

const PROVIDERS: Record<string, Provider> = {
  google: {
    id: 'google',
    userInfo: () => ({
      sub: 'google_mock_user_001',
      email: 'mock.google.user@example.invalid',
      email_verified: true,
      name: 'Mock Google User',
      given_name: 'Mock',
      family_name: 'User',
      locale: 'ja',
    }),
  },
  github: {
    id: 'github',
    userInfo: () => ({
      id: 1010101,
      login: 'mock-github-user',
      name: 'Mock GitHub User',
      email: 'mock.github.user@example.invalid',
    }),
  },
};

// In-memory code registry. The /authorize handler stashes a code → state
// mapping; /token validates the code and consumes it. Codes are single-use.
const codes = new Map<string, { providerId: string; expiresAt: number }>();

function newCode(providerId: string): string {
  const code = `mock_${providerId}_${crypto.randomUUID().replaceAll('-', '')}`;
  codes.set(code, { providerId, expiresAt: Date.now() + 5 * 60 * 1000 });
  return code;
}

function consumeCode(code: string): { providerId: string } | null {
  const entry = codes.get(code);
  if (!entry) return null;
  codes.delete(code);
  if (entry.expiresAt < Date.now()) return null;
  return { providerId: entry.providerId };
}

Deno.serve({ port: PORT, hostname: '0.0.0.0' }, async (req) => {
  const url = new URL(req.url);
  console.log(
    `[oauth-mock] ${req.method} ${url.pathname}${url.search ? '?' + url.searchParams.toString().slice(0, 80) : ''}`,
  );

  if (url.pathname === '/healthz') {
    return new Response('ok', { headers: { 'content-type': 'text/plain' } });
  }

  // /tls-fail/{authorize,token,userinfo} — negative test surface.
  // Used by scripts/oauth-tls-negative.sh to verify the cloud worker
  // surfaces upstream 5xx (what a TLS handshake failure would produce in
  // production) as 502 upstream_oauth_failed rather than crashing.
  //
  // /authorize behaves normally (so the dance reaches /token), but
  // /token + /userinfo always return 503.
  if (url.pathname === '/tls-fail/authorize') {
    const redirectUri = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state');
    if (!redirectUri || !state) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }
    const code = newCode('tls-fail');
    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    target.searchParams.set('state', state);
    return Response.redirect(target.toString(), 302);
  }
  if (url.pathname === '/tls-fail/token' || url.pathname === '/tls-fail/userinfo') {
    return Response.json(
      { error: 'tls_misconfigured', error_description: 'simulated upstream TLS / 5xx' },
      { status: 503 },
    );
  }

  // /authorize — for both providers
  const authzMatch = url.pathname.match(/^\/(google|github)\/authorize$/);
  if (authzMatch) {
    const providerId = authzMatch[1];
    const redirectUri = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state');
    if (!redirectUri || !state) {
      return Response.json({ error: 'invalid_request', error_description: 'redirect_uri and state required' }, {
        status: 400,
      });
    }
    const code = newCode(providerId);
    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    target.searchParams.set('state', state);
    return Response.redirect(target.toString(), 302);
  }

  // /token — google uses /token, github traditionally /access_token. Accept either.
  const tokenMatch = url.pathname.match(/^\/(google|github)\/(?:token|access_token)$/);
  if (tokenMatch && req.method === 'POST') {
    const providerId = tokenMatch[1];
    const body = await req.text();
    const form = new URLSearchParams(body);
    const code = form.get('code');
    if (!code) {
      return Response.json({ error: 'invalid_request', error_description: 'code required' }, { status: 400 });
    }
    const consumed = consumeCode(code);
    if (!consumed || consumed.providerId !== providerId) {
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    }
    const accessToken = `mock_access_${providerId}_${crypto.randomUUID().replaceAll('-', '')}`;
    return Response.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: providerId === 'google' ? 'openid profile email' : 'read:user user:email',
    });
  }

  // /userinfo — google uses /userinfo, github traditionally /user.
  const userInfoMatch = url.pathname.match(/^\/(google|github)\/(?:userinfo|user)$/);
  if (userInfoMatch && req.method === 'GET') {
    const providerId = userInfoMatch[1];
    const provider = PROVIDERS[providerId];
    const auth = req.headers.get('authorization') ?? '';
    if (!/^bearer\s+mock_access_/i.test(auth)) {
      return Response.json({ error: 'invalid_token' }, { status: 401 });
    }
    return Response.json(provider.userInfo());
  }

  return Response.json({ error: 'not_found', path: url.pathname }, { status: 404 });
});

console.log(`[oauth-mock] listening on :${PORT}`);
