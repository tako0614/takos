/**
 * Shared HTML templates for auth pages.
 * Consistent zinc-based dark UI matching the frontend LoginPage.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function page(
  title: string,
  body: string,
  extra?: { style?: string; script?: string; nonce?: string },
) {
  const nonce = extra?.nonce;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} - takos</title>
<style>${BASE_STYLE}${extra?.style ? "\n" + extra.style : ""}</style>
</head>
<body>
${body}
${
    extra?.script
      ? `<script${nonce ? ` nonce="${nonce}"` : ""}>${extra.script}</script>`
      : ""
  }
</body>
</html>`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export { escapeHtml };

/** Simple error page with title, message, and optional link */
export function errorPage(
  title: string,
  message: string,
  linkHref?: string,
  linkText?: string,
): string {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeLinkHref = linkHref ? escapeAttr(linkHref) : undefined;
  const safeLinkText = escapeHtml(linkText || "ホームに戻る");
  return page(
    title,
    `
<div class="card">
  <div class="logo">🐙</div>
  <h1 class="error">${safeTitle}</h1>
  <p class="message">${safeMessage}</p>
  ${safeLinkHref ? `<a href="${safeLinkHref}">${safeLinkText}</a>` : ""}
</div>`,
  );
}
