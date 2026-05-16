import { createComponent, ssr, ssrHydrationKey, escape, ssrAttribute } from 'file:///website/node_modules/solid-js/web/dist/server.js';
import { k as k$1, H as H$1 } from '../nitro/nitro.mjs';
import { createSignal, onMount, onCleanup, For, Show } from 'file:///website/node_modules/solid-js/dist/server.js';
import 'file:///website/node_modules/destr/dist/index.mjs';
import 'file:///website/node_modules/nitropack/node_modules/h3/dist/index.mjs';
import 'file:///website/node_modules/hookable/dist/index.mjs';
import 'file:///website/node_modules/ofetch/dist/node.mjs';
import 'file:///website/node_modules/node-mock-http/dist/index.mjs';
import 'file:///website/node_modules/ufo/dist/index.mjs';
import 'file:///website/node_modules/unstorage/dist/index.mjs';
import 'file:///website/node_modules/unstorage/drivers/fs.mjs';
import 'file:///website/node_modules/unstorage/drivers/fs-lite.mjs';
import 'file:///website/node_modules/ohash/dist/index.mjs';
import 'file:///website/node_modules/klona/dist/index.mjs';
import 'file:///website/node_modules/defu/dist/defu.mjs';
import 'file:///website/node_modules/scule/dist/index.mjs';
import 'node:async_hooks';
import 'file:///website/node_modules/unctx/dist/index.mjs';
import 'file:///website/node_modules/radix3/dist/index.mjs';
import 'file:///website/node_modules/vinxi/lib/app-fetch.js';
import 'file:///website/node_modules/vinxi/lib/app-manifest.js';
import 'node:fs';
import 'node:url';
import 'file:///website/node_modules/pathe/dist/index.mjs';
import 'file:///website/node_modules/cookie-es/dist/index.mjs';
import 'file:///website/node_modules/solid-js/web/storage/dist/storage.js';
import 'file:///website/node_modules/h3/dist/index.mjs';
import 'file:///website/node_modules/seroval/dist/esm/production/index.mjs';
import 'file:///website/node_modules/seroval-plugins/dist/esm/production/web.mjs';

var $ = ["<svg", ' viewBox="0 0 48 48" fill="none" role="img"', '><defs><linearGradient id="tg-geo" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="var(--tg-grad-from, #5d3afd)"></stop><stop offset="1" stop-color="var(--tg-grad-to, #00b1ff)"></stop></linearGradient></defs><rect x="6" y="6" width="30" height="10" rx="2.5" fill="url(#tg-geo)" opacity="0.55"></rect><rect x="9" y="19" width="30" height="10" rx="2.5" fill="url(#tg-geo)" opacity="0.78"></rect><rect x="12" y="32" width="30" height="10" rx="2.5" fill="url(#tg-geo)"></rect></svg>'];
function b(e) {
  var _a;
  const a = () => {
    var _a2;
    return (_a2 = e.size) != null ? _a2 : 48;
  };
  return ssr($, ssrHydrationKey() + ssrAttribute("width", escape(a(), true), false) + ssrAttribute("height", escape(a(), true), false), ssrAttribute("aria-label", escape((_a = e.title) != null ? _a : "Takosumi logo", true), false) + ssrAttribute("class", escape(e.class, true), false));
}
var w = ["<svg", ' viewBox="0 0 48 48" fill="none" role="img"', '><defs><linearGradient id="tg-ink" x1="24" y1="4" x2="24" y2="44" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="var(--tg-grad-from, #5d3afd)"></stop><stop offset="1" stop-color="var(--tg-grad-to, #00b1ff)"></stop></linearGradient></defs><path d="M24 4 C18 16, 8 22, 8 31 C8 39, 15 44, 24 44 C33 44, 40 39, 40 31 C40 22, 30 16, 24 4 Z" fill="url(#tg-ink)"></path><path d="M30 30 a6 6 0 1 1 -10 -3 a4 4 0 1 1 7 1.5" stroke="var(--tg-bg, #fdfdfd)" stroke-width="1.6" stroke-linecap="round" fill="none" opacity="0.92"></path></svg>'];
function C(e) {
  var _a;
  const a = () => {
    var _a2;
    return (_a2 = e.size) != null ? _a2 : 48;
  };
  return ssr(w, ssrHydrationKey() + ssrAttribute("width", escape(a(), true), false) + ssrAttribute("height", escape(a(), true), false), ssrAttribute("aria-label", escape((_a = e.title) != null ? _a : "Takosumi logo", true), false) + ssrAttribute("class", escape(e.class, true), false));
}
var x = ["<a", ' href="/" class="', '" aria-label="Takos home"><!--$-->', '<!--/--><span class="wordmark-text">Takos</span></a>'];
function g(e) {
  var _a;
  const a = () => e.variant === "geometric" ? createComponent(b, { get size() {
    var _a2;
    return (_a2 = e.size) != null ? _a2 : 28;
  } }) : createComponent(C, { get size() {
    var _a2;
    return (_a2 = e.size) != null ? _a2 : 28;
  } });
  return ssr(x, ssrHydrationKey(), `wordmark ${escape((_a = e.class) != null ? _a : "", true)}`, escape(createComponent(a, {})));
}
var M = ["<svg", ' width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path></svg>'], T = ["<svg", ' width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5"></circle><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>'], _ = ["<svg", ' width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>'], A = ["<button", ' class="nav-icon theme-toggle" type="button" title="', '" aria-label="', '"', "><!--$-->", "<!--/--><!--$-->", "<!--/--><!--$-->", "<!--/--></button>"];
function S() {
  if (typeof localStorage > "u") return "auto";
  const e = localStorage.getItem("tg-theme");
  return e === "light" || e === "dark" ? e : "auto";
}
function G(e) {
  if (typeof document > "u") return;
  const a = document.documentElement;
  e === "auto" ? a.removeAttribute("data-theme") : a.setAttribute("data-theme", e);
}
function I() {
  const [e, a] = createSignal("auto");
  return onMount(() => {
    const i = S();
    a(i), G(i);
  }), ssr(A, ssrHydrationKey(), `Theme: ${escape(e(), true)}`, `Theme: ${escape(e(), true)}`, ssrAttribute("data-mode", escape(e(), true), false), escape(createComponent(Show, { get when() {
    return e() === "auto";
  }, get children() {
    return ssr(M, ssrHydrationKey());
  } })), escape(createComponent(Show, { get when() {
    return e() === "light";
  }, get children() {
    return ssr(T, ssrHydrationKey());
  } })), escape(createComponent(Show, { get when() {
    return e() === "dark";
  }, get children() {
    return ssr(_, ssrHydrationKey());
  } })));
}
const u = "https://cloud.takosumi.test/apps/install?git=https%3A%2F%2Fgithub.com%2Ftako0614%2Ftakos.git&ref=main&mode=shared-cell&autopreview=1";
var B = ["<header", ' class="', '"><div class="nav-inner container"><!--$-->', '<!--/--><nav class="nav-links" aria-label="Primary"><a href="#features">Features</a><a href="#apps">Bundled apps</a><a href="https://docs.takos.jp/" rel="external">Docs</a><a href="https://cloud.takosumi.com/" rel="noopener">Cloud</a></nav><div class="nav-actions"><a class="nav-icon" href="https://github.com/tako0614/takos" rel="noopener" aria-label="GitHub"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.32-1.28-1.67-1.28-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.07.78 2.15v3.18c0 .31.21.68.8.56C20.21 21.38 23.5 17.07 23.5 12 23.5 5.65 18.35.5 12 .5z"></path></svg></a><!--$-->', '<!--/--><a class="btn btn-primary nav-cta"', ' rel="noopener">Install</a></div></div></header>'];
function z() {
  const [e, a] = createSignal(false);
  return onMount(() => {
    const i = () => {
      a(window.scrollY > window.innerHeight * 0.7);
    };
    i(), window.addEventListener("scroll", i, { passive: true }), onCleanup(() => window.removeEventListener("scroll", i));
  }), ssr(B, ssrHydrationKey(), `nav ${e() ? "is-scrolled" : ""}`, escape(createComponent(g, { variant: "inkdrop" })), escape(createComponent(I, {})), ssrAttribute("href", escape(u, true), false));
}
var L = ["<div", "><pre>", "</pre></div>"];
function k(e) {
  const a = () => {
    const i = ["codeblock"];
    return e.terminal && i.push("code-terminal"), e.class && i.push(e.class), i.join(" ");
  };
  return ssr(L, ssrHydrationKey() + ssrAttribute("class", escape(a(), true), false), escape(e.children));
}
var P = ["<svg", ' viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"', '><defs><radialGradient id="', '" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="var(--tg-grad-from)" stop-opacity="0.95"></stop><stop offset="55%" stop-color="var(--tg-grad-mid)" stop-opacity="0.7"></stop><stop offset="100%" stop-color="var(--tg-grad-to)" stop-opacity="0"></stop></radialGradient><filter id="', '" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"></feGaussianBlur></filter></defs><!--$-->', "<!--/--><!--$-->", "<!--/--><!--$-->", "<!--/--></svg>"], F = ["<g", ' filter="', '"><path d="M260 70 C 380 50, 500 160, 470 280 C 560 320, 540 460, 410 510 C 320 560, 210 530, 160 450 C 60 410, 70 290, 150 240 C 130 150, 190 80, 260 70 Z" fill="', '"></path><circle cx="120" cy="180" r="22" fill="', '" opacity="0.7"></circle><circle cx="510" cy="430" r="14" fill="', '" opacity="0.6"></circle><circle cx="430" cy="100" r="9" fill="', '" opacity="0.5"></circle></g>'], j = ["<g", ' filter="', '"><path d="M120 380 C 30 320, 80 180, 200 170 C 280 60, 460 90, 490 220 C 590 240, 580 420, 470 470 C 360 540, 200 510, 170 430 C 130 425, 110 405, 120 380 Z" fill="', '"></path><circle cx="80" cy="450" r="18" fill="', '" opacity="0.55"></circle><circle cx="540" cy="320" r="10" fill="', '" opacity="0.7"></circle></g>'], U = ["<g", ' filter="', '"><path d="M300 80 C 470 80, 520 220, 480 320 C 540 410, 460 540, 320 520 C 200 540, 110 470, 130 360 C 70 280, 130 130, 230 110 C 250 90, 280 80, 300 80 Z" fill="', '"></path><circle cx="170" cy="200" r="14" fill="', '" opacity="0.6"></circle><circle cx="500" cy="140" r="8" fill="', '" opacity="0.55"></circle><circle cx="460" cy="500" r="20" fill="', '" opacity="0.5"></circle></g>'];
function H(e) {
  const a = () => {
    var _a;
    return (_a = e.variant) != null ? _a : 1;
  };
  return ssr(P, ssrHydrationKey(), ssrAttribute("class", escape(e.class, true), false), `ink-${escape(a(), true)}`, `ink-blur-${escape(a(), true)}`, a() === 1 && ssr(F, ssrHydrationKey(), `url(#ink-blur-${escape(a(), true)})`, `url(#ink-${escape(a(), true)})`, `url(#ink-${escape(a(), true)})`, `url(#ink-${escape(a(), true)})`, `url(#ink-${escape(a(), true)})`), a() === 2 && ssr(j, ssrHydrationKey(), `url(#ink-blur-${escape(a(), true)})`, `url(#ink-${escape(a(), true)})`, `url(#ink-${escape(a(), true)})`, `url(#ink-${escape(a(), true)})`), a() === 3 && ssr(U, ssrHydrationKey(), `url(#ink-blur-${escape(a(), true)})`, `url(#ink-${escape(a(), true)})`, `url(#ink-${escape(a(), true)})`, `url(#ink-${escape(a(), true)})`, `url(#ink-${escape(a(), true)})`));
}
var V = ["<span", ' class="c"># \u3069\u3053\u306B\u3067\u3082 install \u3067\u304D\u308B\u304C\u3001 \u4E00\u756A\u901F\u3044\u306E\u306F Takosumi Cloud\u3002</span>'], d = ["<span", ' class="k">$</span>'], E = ["<span", ' class="c"># \u81EA\u524D substrate \u306B\u3082\u540C\u3058 manifest \u3067 deploy \u53EF:</span>'], D = ["<span", ' class="c"> \u2713 takos-app \u2192 http://your-takos.example/</span>'], O = ["<span", ' class="c"> \u2713 takos-git \u2192 docs / files / agents</span>'], W = ["<section", ' class="hero"><!--$-->', '<!--/--><div class="container hero-grid"><div class="hero-copy"><span class="eyebrow">\u58A8 \xB7 open source \xB7 AI-first</span><h1><span class="hero-line">AI \u3068\u8A71\u3059\u5834\u6240\u306F\u3001</span><span class="hero-line grad-text">\u3042\u306A\u305F\u306E</span><span class="hero-line">\u30B5\u30FC\u30D0\u30FC\u3067\u3002</span></h1><p class="lede">Chat / agent / memory / space \u3092 core \u306B\u6301\u3064\u3001 self-hostable \u306A AI chat product\u3002 <code>takos-docs</code> \u3084 <code>yurucommu</code> \u306A\u3093\u304B\u306E bundled apps \u306F\u65B0\u898F space \u4F5C\u6210\u3068\u540C\u6642\u306B auto-install \u3055\u308C\u308B\u3002 history \u3082 memory \u3082\u81EA\u5206\u306E VM \u306E\u5916\u306B\u51FA\u306A\u3044\u3002</p><div class="cta-row"><a class="btn btn-primary"', ' rel="noopener">Takosumi Cloud \u3067 install \u2192</a><a class="btn btn-secondary" href="https://github.com/tako0614/takos" rel="noopener">GitHub</a></div></div><div class="hero-terminal">', '</div></div><div class="hero-scroll" aria-hidden="true">scroll<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg></div></section>'];
function Z() {
  return ssr(W, ssrHydrationKey(), escape(createComponent(H, { class: "hero-splash", variant: 1 })), ssrAttribute("href", escape(u, true), false), escape(createComponent(k, { terminal: true, get children() {
    return [ssr(V, ssrHydrationKey()), `
`, ssr(d, ssrHydrationKey()), " open https://cloud.takosumi.com", `
`, ssr(d, ssrHydrationKey()), "   ", "\u2192 Install Takos (1-click)", `
`, ssr(E, ssrHydrationKey()), `
`, ssr(d, ssrHydrationKey()), " takosumi deploy ./takos.manifest.yml", `
`, ssr(D, ssrHydrationKey()), `
`, ssr(O, ssrHydrationKey())];
  } })));
}
const R = [{ title: "Chat / agent / memory / space", body: "Core \u306F\u3053\u306E 4 \u3064\u3002 LLM \u3068\u306E\u3084\u308A\u53D6\u308A\u306F agent \u304C\u56DE\u3057\u3001 memory \u306F\u3042\u306A\u305F\u306E space \u306B\u7A4D\u307F\u4E0A\u304C\u308B\u3002 \u5C65\u6B74\u306F\u81EA\u5206\u306E\u30B5\u30FC\u30D0\u30FC\u304B\u3089\u51FA\u306A\u3044\u3002" }, { title: "Bundled apps \u304C auto-install", body: "takos-docs / takos-slide / takos-excel / takos-computer / yurucommu \u2014 \u65B0\u898F space \u4F5C\u6210\u3068\u540C\u6642\u306B install \u6E08\u307F\u3002 \u4E0D\u8981\u306A\u3089 uninstall \u3067\u304D\u308B\u3002" }, { title: "Takosumi \u4E0A\u3067\u52D5\u304F", body: "Takos \u306F Takosumi PaaS \u306E\u4E0A\u3067\u52D5\u304F top-level product\u3002 \u3060\u304B\u3089 Cloudflare / AWS / GCP / docker / \u81EA\u524D VM \u306E\u3069\u3053\u306B\u3067\u3082\u540C\u3058 manifest \u3067 deploy \u3067\u304D\u308B\u3002" }, { title: "Federation \u3067\u7E4B\u304C\u308B", body: "ActivityPub \u7D4C\u7531\u3067\u4ED6\u306E Takos \u30A4\u30F3\u30B9\u30BF\u30F3\u30B9\u3084 fediverse \u3068 connection\u3002 \u30B5\u30A4\u30ED\u5316\u3057\u306A\u3044\u3001 \u3067\u3082\u81EA\u5206\u306E data \u306F\u81EA\u5206\u306E VM \u306E\u4E2D\u3002" }, { title: "Self-host first", body: "\u500B\u4EBA\u306E small VM \u304B\u3089 enterprise \u306E K8s cluster \u307E\u3067\u3001 \u540C\u3058 Takos binary \u304C\u52D5\u304F\u3002 SaaS lock-in \u3082 vendor lock-in \u3082\u7121\u3057\u3002" }, { title: "OSS / forkable", body: "AGPL\u3002 \u30B3\u30FC\u30C9\u5168\u90E8 public \u3067\u3001 fork \u3057\u3066\u3042\u306A\u305F\u4ED5\u69D8\u306B\u3067\u304D\u308B\u3002 contributor \u3082\u6B53\u8FCE\u3002" }];
var K = ["<section", ' id="features"><div class="container"><span class="eyebrow">features</span><h2>Manifest 1 \u672C\u3067\u3067\u304D\u308B\u3053\u3068\u3002</h2><div class="features">', "</div></div></section>"], N = ["<article", ' class="feature"><h4>', "</h4><p>", "</p></article>"];
function Y() {
  return ssr(K, ssrHydrationKey(), escape(createComponent(For, { each: R, children: (e) => ssr(N, ssrHydrationKey(), escape(e.title), escape(e.body)) })));
}
var q = ["<section", ' id="apps"><div class="container"><span class="eyebrow">bundled apps</span><h2>\u65B0\u898F space \u3067 auto-install\u3002</h2><p class="lede">Takos distribution \u3068\u4E00\u7DD2\u306B ship \u3055\u308C\u308B 1st-party \u306E InstallableApp\u3002 \u65B0\u898F space \u4F5C\u6210\u3068\u540C\u6642\u306B install \u6E08\u307F\u3001 \u5FC5\u8981\u306A\u3051\u308C\u3070 uninstall \u3067\u304D\u308B\u3002</p><div class="features">', "</div></div></section>"], J = ["<article", ' class="feature"><h4><!--$-->', '<!--/--> <span class="feature-tag">', "</span></h4><p>", "</p></article>"];
const Q = [{ name: "takos-docs", tag: "docs", body: "\u30CE\u30FC\u30C8 + \u30C9\u30AD\u30E5\u30E1\u30F3\u30C8\u3002 markdown + collaborative editor\u3002" }, { name: "takos-slide", tag: "slides", body: "\u30D7\u30EC\u30BC\u30F3\u4F5C\u6210\u3002 keynote/slides \u306E\u4EE3\u66FF\u3002" }, { name: "takos-excel", tag: "sheet", body: "\u30B9\u30D7\u30EC\u30C3\u30C9\u30B7\u30FC\u30C8\u3002 calc + formula \u5BFE\u5FDC\u3002" }, { name: "takos-computer", tag: "agent-tool", body: "agent \u304B\u3089\u547C\u3073\u51FA\u305B\u308B computer use \u74B0\u5883\u3002" }, { name: "yurucommu", tag: "social", body: "self-hosted ActivityPub / community social\u3002 fediverse \u306B\u7E4B\u304C\u308B\u3002" }];
function X() {
  return ssr(q, ssrHydrationKey(), escape(createComponent(For, { each: Q, children: (e) => ssr(J, ssrHydrationKey(), escape(e.name), escape(e.tag), escape(e.body)) })));
}
var p = ["<span", ' class="k">$</span>'], tt = ["<section", ' id="install" class="end-cta"><div class="container"><span class="eyebrow">install</span><h2>\u59CB\u3081\u308B\u306B\u306F 2 \u901A\u308A\u3002</h2><p class="lede">Takos \u306F Takosumi \u4E0A\u3067\u52D5\u304F\u306E\u3067\u3001 Takosumi Cloud \u304B\u3089 1-click install \u3067\u304D\u308B\u3002 \u81EA\u5206\u306E cloud / \u81EA\u524D VM \u3067\u52D5\u304B\u3057\u305F\u3044\u306A\u3089\u3001 manifest \u3092 <code>takosumi deploy</code> \u306B\u6E21\u3059\u3060\u3051\u3002</p><div class="install-options"><div class="install-card install-card-highlight"><h3>1-click install \u2014 Takosumi Cloud</h3><p>\u30DC\u30BF\u30F3\u3092\u62BC\u3059\u3068 cloud.takosumi.com \u306E install wizard \u304C\u958B\u304D\u3001 git URL + ref \u304C pre-fill \u3055\u308C\u305F\u72B6\u614B\u3067 preview \u2192 install \u3067\u304D\u308B\u3002</p><a class="btn btn-primary"', ' rel="noopener">Cloud \u3067 install \u2192</a></div><div class="install-card"><h3>Self-host \u2014 takosumi CLI</h3><p>\u81EA\u524D\u306E Takosumi kernel \u306B\u76F4\u63A5 deploy \u3057\u305F\u3044\u4EBA\u5411\u3051\u3002 manifest \u3092 1 \u884C\u5909\u3048\u308B\u3060\u3051\u3067 AWS / GCP / Cloudflare / docker / VM \u306B\u5C4A\u304F\u3002</p><!--$-->', "<!--/--></div></div></div></section>"];
function et() {
  return ssr(tt, ssrHydrationKey(), ssrAttribute("href", escape(u, true), false), escape(createComponent(k, { terminal: true, get children() {
    return [ssr(p, ssrHydrationKey()), " deno install -gA -n takosumi \\", `
`, "  ", "jsr:@takos/takosumi-cli", `
`, ssr(p, ssrHydrationKey()), " takosumi deploy ./takos.manifest.yml"];
  } })));
}
var at = ["<footer", ' class="site"><div class="container"><div style="display:flex;align-items:center;gap:12px;"><!--$-->', '<!--/--><span class="copy">\xA9 Takos contributors \u2014 AGPL \xB7 Powered by Takosumi.</span></div><nav aria-label="Footer"><a href="https://docs.takos.jp/" rel="external">Docs</a><a href="https://github.com/tako0614/takos" rel="noopener">GitHub</a><a href="https://takosumi.com/" rel="external">Takosumi</a><a href="https://cloud.takosumi.com/" rel="noopener">Cloud</a></nav></div></footer>'];
function rt() {
  return ssr(at, ssrHydrationKey(), escape(createComponent(g, { variant: "inkdrop", size: 20 })));
}
var st = ["<main", "><!--$-->", "<!--/--><!--$-->", "<!--/--><!--$-->", "<!--/--><!--$-->", "<!--/--></main>"];
function nt() {
  return [createComponent(k$1, { children: "Takos \u2014 AI-first chat & agent, your own server." }), createComponent(H$1, { name: "description", content: "Self-hostable \u306A AI-first chat & agent product\u3002 chat / agent / memory / space \u3092 core \u306B\u6301\u3061\u3001 docs / slide / excel / social \u306A\u3069\u306E bundled apps \u304C auto-install \u3055\u308C\u308B\u3002 Takosumi PaaS \u306E\u4E0A\u3067\u52D5\u304F\u306E\u3067 Cloudflare / AWS / \u81EA\u524D VM \u3069\u3053\u3067\u3082 deploy \u53EF\u3002" }), createComponent(H$1, { property: "og:title", content: "Takos \u2014 AI-first chat & agent, your own server." }), createComponent(H$1, { property: "og:description", content: "AI-first chat product\u3002 1-click \u3067 Takosumi Cloud \u306B install\u3001 \u81EA\u524D substrate \u306B\u3082\u540C\u3058 manifest \u3067 deploy\u3002" }), createComponent(H$1, { property: "og:url", content: "https://takos.jp/" }), createComponent(H$1, { property: "og:type", content: "website" }), createComponent(H$1, { property: "og:image", content: "https://takos.jp/brand/geometric.svg" }), createComponent(z, {}), ssr(st, ssrHydrationKey(), escape(createComponent(Z, {})), escape(createComponent(Y, {})), escape(createComponent(X, {})), escape(createComponent(et, {}))), createComponent(rt, {})];
}

export { nt as default };
//# sourceMappingURL=index2.mjs.map
