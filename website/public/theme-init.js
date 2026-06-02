/* Runs render-blocking in <head> (CSP script-src 'self' compliant).
 * Dark-only site — no theme restoration. This only:
 * 1. marks the document as JS-enabled so scroll-reveal can hide content
 *    only when JS can later reveal it (no-JS users see everything).
 * 2. sets <html lang> for the prerendered EN route (static HTML ships lang=ja). */
(function () {
  try {
    var el = document.documentElement;
    el.classList.add('js');
    if (location.pathname.indexOf('/en') === 0) el.setAttribute('lang', 'en');
  } catch (e) {
    /* no-op: lang just falls back to default */
  }
})();
