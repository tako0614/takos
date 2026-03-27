/**
 * Shared HTML templates for auth pages.
 * Consistent zinc-based dark UI matching the frontend LoginPage.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BASE_STYLE = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: system-ui, -apple-system, sans-serif; background: #09090b; min-height: 100vh; display: flex; justify-content: center; align-items: center; padding: 16px; color: #fafafa; }
.card { width: 100%; max-width: 384px; background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 32px; text-align: center; }
.logo { font-size: 48px; margin-bottom: 24px; }
h1 { font-size: 24px; font-weight: 700; color: #fafafa; margin-bottom: 8px; }
h1.error { color: #ef4444; }
h1.warning { color: #f59e0b; }
.subtitle { color: #a1a1aa; font-size: 14px; margin-bottom: 32px; line-height: 1.6; }
.message { color: #a1a1aa; font-size: 14px; margin: 16px 0; line-height: 1.6; }
a { color: #3b82f6; text-decoration: none; }
a:hover { text-decoration: underline; }
.btn { display: flex; align-items: center; justify-content: center; gap: 12px; width: 100%; padding: 12px 16px; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; text-decoration: none; transition: background 0.15s; color: #fafafa; }
.btn:hover { text-decoration: none; }
.btn-google { background: #ffffff; color: #18181b; }
.btn-google:hover { background: #f4f4f5; }
.btn-allow { background: #2563eb; color: #fff; }
.btn-allow:hover { background: #1d4ed8; }
.btn-deny { background: #27272a; color: #a1a1aa; }
.btn-deny:hover { background: #3f3f46; }
.buttons { display: flex; gap: 12px; margin-top: 24px; }
.buttons button, .buttons .btn { flex: 1; }
.footer { margin-top: 24px; font-size: 12px; color: #52525b; }
`.trim();

const GOOGLE_SVG = `<svg width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`;

const SPINNER_STYLE = `
.loading { display: flex; flex-direction: column; align-items: center; gap: 16px; }
.spinner { width: 32px; height: 32px; border: 3px solid #27272a; border-top-color: #3b82f6; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.login-form { display: none; }
.login-form.visible { display: block; }
`;

function page(title: string, body: string, extra?: { style?: string; script?: string; nonce?: string }) {
  const nonce = extra?.nonce;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} - takos</title>
<style>${BASE_STYLE}${extra?.style ? '\n' + extra.style : ''}</style>
</head>
<body>
${body}
${extra?.script ? `<script${nonce ? ` nonce="${nonce}"` : ''}>${extra.script}</script>` : ''}
</body>
</html>`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export { escapeHtml };

function resolveHomeLink(homeUrl?: string, homeLabel?: string): { href: string; label: string } {
  const fallback = { href: '/', label: 'ホーム' };
  if (!homeUrl) {
    return fallback;
  }

  try {
    const parsed = new URL(homeUrl);
    return {
      href: parsed.toString(),
      label: homeLabel?.trim() || parsed.host || fallback.label,
    };
  } catch {
    // Malformed URL -- fall back to raw string values
    return {
      href: homeUrl,
      label: homeLabel?.trim() || homeUrl,
    };
  }
}

/** Simple error page with title, message, and optional link */
export function errorPage(title: string, message: string, linkHref?: string, linkText?: string): string {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeLinkHref = linkHref ? escapeAttr(linkHref) : undefined;
  const safeLinkText = escapeHtml(linkText || 'ホームに戻る');
  return page(title, `
<div class="card">
  <div class="logo">🐙</div>
  <h1 class="error">${safeTitle}</h1>
  <p class="message">${safeMessage}</p>
  ${safeLinkHref ? `<a href="${safeLinkHref}">${safeLinkText}</a>` : ''}
</div>`);
}

/** Warning page (e.g. setup required) */
export function warningPage(title: string, message: string, linkHref?: string, linkText?: string): string {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeLinkHref = linkHref ? escapeAttr(linkHref) : undefined;
  const safeLinkText = escapeHtml(linkText || 'ホームに戻る');
  return page(title, `
<div class="card">
  <div class="logo">🐙</div>
  <h1 class="warning">${safeTitle}</h1>
  <p class="message">${safeMessage}</p>
  ${safeLinkHref ? `<a href="${safeLinkHref}">${safeLinkText}</a>` : ''}
</div>`);
}

/** External service login page with session check + Google button */
export function externalLoginPage(opts: {
  serviceName: string;
  googleOAuthUrl: string;
  encodedRedirectUri: string;
  nonce: string;
  homeUrl?: string;
  homeLabel?: string;
}): string {
  const safeServiceName = escapeHtml(opts.serviceName);
  const safeGoogleOAuthUrl = escapeAttr(opts.googleOAuthUrl);
  const homeLink = resolveHomeLink(opts.homeUrl, opts.homeLabel);
  const safeHomeHref = escapeAttr(homeLink.href);
  const safeHomeLabel = escapeHtml(homeLink.label);
  return page('ログイン', `
<div class="card">
  <div class="logo">🐙</div>
  <h1>takos にログイン</h1>
  <p class="subtitle"><span style="color:#3b82f6">${safeServiceName}</span> を利用するには<br>takos アカウントでログインしてください</p>
  <div id="loading" class="loading">
    <div class="spinner"></div>
    <p style="color:#a1a1aa;font-size:14px">ログイン状態を確認中...</p>
  </div>
  <div id="loginForm" class="login-form">
    <a href="${safeGoogleOAuthUrl}" class="btn btn-google">${GOOGLE_SVG} Google でログイン</a>
  </div>
  <div class="footer"><a href="${safeHomeHref}">${safeHomeLabel}</a> に戻る</div>
</div>`, {
    style: SPINNER_STYLE,
    nonce: opts.nonce,
    script: `
var redirectUri = decodeURIComponent('${opts.encodedRedirectUri}');
(async function() {
  try {
    var res = await fetch('/auth/external/session', { credentials: 'include' });
    var data = await res.json();
    if (data.logged_in && data.token) {
      var form = document.createElement('form');
      form.method = 'POST';
      form.action = redirectUri;

      var tokenInput = document.createElement('input');
      tokenInput.type = 'hidden';
      tokenInput.name = 'token';
      tokenInput.value = data.token;
      form.appendChild(tokenInput);

      document.body.appendChild(form);
      form.submit();
    } else {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('loginForm').classList.add('visible');
    }
  } catch (e) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('loginForm').classList.add('visible');
  }
})();`,
  });
}

/** External auth redirect page that POSTs token without leaking it in URL */
export function externalTokenPostRedirectPage(opts: {
  redirectUri: string;
  token: string;
  nonce: string;
}): string {
  const redirectUri = escapeAttr(opts.redirectUri);
  const token = escapeAttr(opts.token);
  return page('Redirecting', `
<div class="card">
  <div class="logo">🐙</div>
  <h1>Redirecting...</h1>
  <p class="subtitle">認証が完了しました。サービスへ戻ります。</p>
  <form id="externalAuthPost" method="POST" action="${redirectUri}" style="display:none">
    <input type="hidden" name="token" value="${token}" />
  </form>
  <noscript>
    <p class="message">JavaScript が無効です。以下のボタンを押してください。</p>
    <button form="externalAuthPost" class="btn btn-allow">続行</button>
  </noscript>
</div>`, {
    nonce: opts.nonce,
    script: `
document.getElementById('externalAuthPost')?.submit();
`,
  });
}

/** OAuth consent page */
export function consentPage(opts: {
  clientName: string;
  clientLogoUri: string | null;
  userEmail: string;
  identityScopes: string[];
  resourceScopes: string[];
  hiddenFields: Record<string, string>;
}): string {
  const logo = opts.clientLogoUri
    ? `<img src="${opts.clientLogoUri}" alt="" style="width:48px;height:48px;border-radius:12px;margin:0 auto 16px">`
    : '';

  const scopeItems = (items: string[]) =>
    items.map((s) => `<div style="padding:8px 0;border-bottom:1px solid #27272a;font-size:13px;color:#d4d4d8">${s}</div>`).join('');

  const hiddenInputs = Object.entries(opts.hiddenFields)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${value}">`)
    .join('\n    ');

  return page(`${opts.clientName} を承認`, `
<div class="card">
  ${logo}
  <h1 style="font-size:18px">${opts.clientName}</h1>
  <p style="color:#71717a;font-size:12px;margin:4px 0 16px">${opts.userEmail} でログイン中</p>
  <p style="color:#a1a1aa;font-size:14px;margin-bottom:16px"><strong style="color:#fafafa">${opts.clientName}</strong> があなたのアカウントへのアクセスを要求しています</p>
  <div style="background:#09090b;border-radius:8px;padding:12px;margin-bottom:8px;text-align:left">
    ${opts.identityScopes.length > 0 ? `<div style="font-size:12px;font-weight:600;color:#71717a;margin-bottom:4px">アカウント情報</div>${scopeItems(opts.identityScopes)}` : ''}
    ${opts.resourceScopes.length > 0 ? `<div style="font-size:12px;font-weight:600;color:#71717a;margin-top:8px;margin-bottom:4px">権限</div>${scopeItems(opts.resourceScopes)}` : ''}
  </div>
  <form method="POST" action="/oauth/authorize">
    ${hiddenInputs}
    <div class="buttons">
      <button type="submit" name="action" value="deny" class="btn btn-deny">拒否</button>
      <button type="submit" name="action" value="allow" class="btn btn-allow">許可</button>
    </div>
  </form>
</div>`);
}

/** OAuth device flow: entry page */
export function deviceCodeEntryPage(opts: {
  userEmail: string;
  presetUserCode: string | null;
  message: string | null;
  homeUrl?: string;
  homeLabel?: string;
}): string {
  const preset = opts.presetUserCode ?? '';
  const msg = opts.message ? `<p class="message" style="color:#f59e0b">${opts.message}</p>` : '';
  const homeLink = resolveHomeLink(opts.homeUrl, opts.homeLabel);
  const safeHomeHref = escapeAttr(homeLink.href);
  const safeHomeLabel = escapeHtml(homeLink.label);

  return page('デバイス認証', `
<div class="card">
  <div class="logo">🐙</div>
  <h1>デバイス認証</h1>
  <p class="subtitle">${opts.userEmail} でログイン中</p>
  <p class="message">デバイスに表示されたコードを入力してください。</p>
  ${msg}
  <form method="GET" action="/oauth/device" style="margin-top:16px;text-align:left">
    <label style="display:block;font-size:12px;color:#a1a1aa;margin-bottom:8px">コード</label>
    <input
      name="user_code"
      value="${preset}"
      autocomplete="one-time-code"
      inputmode="latin"
      style="width:100%;padding:12px 14px;border-radius:10px;border:1px solid #27272a;background:#09090b;color:#fafafa;font-size:16px;letter-spacing:2px;text-transform:uppercase"
      placeholder="ABCD-EFGH"
      required
    />
    <div style="margin-top:16px">
      <button type="submit" class="btn btn-allow">続行</button>
    </div>
  </form>
  <div class="footer"><a href="${safeHomeHref}">${safeHomeLabel}</a></div>
</div>`);
}

/** OAuth device flow: consent page */
export function deviceConsentPage(opts: {
  clientName: string;
  clientLogoUri: string | null;
  userEmail: string;
  userCode: string;
  csrfToken: string;
  identityScopes: string[];
  resourceScopes: string[];
}): string {
  const logo = opts.clientLogoUri
    ? `<img src="${opts.clientLogoUri}" alt="" style="width:48px;height:48px;border-radius:12px;margin:0 auto 16px">`
    : '';

  const scopeItems = (items: string[]) =>
    items.map((s) => `<div style="padding:8px 0;border-bottom:1px solid #27272a;font-size:13px;color:#d4d4d8">${s}</div>`).join('');

  return page(`${opts.clientName} を承認`, `
<div class="card">
  ${logo}
  <h1 style="font-size:18px">${opts.clientName}</h1>
  <p style="color:#71717a;font-size:12px;margin:4px 0 16px">${opts.userEmail} でログイン中</p>
  <p style="color:#a1a1aa;font-size:14px;margin-bottom:16px"><strong style="color:#fafafa">${opts.clientName}</strong> がデバイス認証を要求しています</p>
  <p style="color:#71717a;font-size:12px;margin:-8px 0 16px">コード: <span style="color:#d4d4d8;letter-spacing:2px;text-transform:uppercase">${opts.userCode}</span></p>
  <div style="background:#09090b;border-radius:8px;padding:12px;margin-bottom:8px;text-align:left">
    ${opts.identityScopes.length > 0 ? `<div style="font-size:12px;font-weight:600;color:#71717a;margin-bottom:4px">アカウント情報</div>${scopeItems(opts.identityScopes)}` : ''}
    ${opts.resourceScopes.length > 0 ? `<div style="font-size:12px;font-weight:600;color:#71717a;margin-top:8px;margin-bottom:4px">権限</div>${scopeItems(opts.resourceScopes)}` : ''}
    ${(opts.identityScopes.length === 0 && opts.resourceScopes.length === 0) ? `<div style="font-size:13px;color:#a1a1aa">追加の権限はありません。</div>` : ''}
  </div>
  <form method="POST" action="/oauth/device">
    <input type="hidden" name="user_code" value="${opts.userCode}">
    <input type="hidden" name="csrf_token" value="${opts.csrfToken}">
    <div class="buttons">
      <button type="submit" name="action" value="deny" class="btn btn-deny">拒否</button>
      <button type="submit" name="action" value="allow" class="btn btn-allow">許可</button>
    </div>
  </form>
</div>`);
}

/** OAuth device flow: result page */
export function deviceResultPage(opts: {
  title: string;
  message: string;
  homeUrl?: string;
  homeLabel?: string;
}): string {
  const homeLink = resolveHomeLink(opts.homeUrl, opts.homeLabel);
  const safeHomeHref = escapeAttr(homeLink.href);
  const safeHomeLabel = escapeHtml(homeLink.label);
  return page(opts.title, `
<div class="card">
  <div class="logo">🐙</div>
  <h1>${opts.title}</h1>
  <p class="message">${opts.message}</p>
  <div class="footer"><a href="${safeHomeHref}">${safeHomeLabel}</a></div>
</div>`);
}
