import { createEffect, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import { Router } from "@solidjs/router";
import App from "./App.tsx";
import { AppRoutes } from "./app-routes.tsx";
import { useTheme } from "./store/theme.ts";
import { useI18n } from "./store/i18n.ts";
import "./styles.css";

if (import.meta.env.PROD) {
  const isStagingDebug = import.meta.env.MODE === "staging-debug";
  if (!isStagingDebug) {
    const noop = () => {};
    console.debug = noop;
    console.log = noop;
    console.info = noop;
    console.warn = noop;
    console.error = noop;
  } else {
    // Staging-debug still surfaces console.error/warn for triage, but we scrub
    // common secret-looking substrings before they hit the browser console so
    // that screenshots / shared traces don't leak tokens.
    //
    // Patterns we redact (best-effort, additive — server-side log redaction is
    // still the authoritative defense):
    //   - Bearer tokens / Authorization headers
    //   - JWT-shaped tokens (xxx.yyy.zzz, base64url segments)
    //   - Long hex / base64 secrets that look like API keys
    //   - `password=`, `token=`, `secret=`, `api_key=` query/form fragments
    const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
      /(authorization\s*[:=]\s*)bearer\s+[^\s"']+/gi,
      /(authorization\s*[:=]\s*)[^\s"']+/gi,
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      /\b(sk|pk|rk|api[-_]?key|token|secret|password)[-_=:]+[A-Za-z0-9._\-+/=]{12,}/gi,
      /\b[A-Fa-f0-9]{32,}\b/g,
    ];

    const scrubString = (value: string): string => {
      let out = value;
      for (const pattern of SECRET_PATTERNS) {
        out = out.replace(
          pattern,
          (_match, prefix?: string) => `${prefix ?? ""}[REDACTED]`,
        );
      }
      return out;
    };

    const scrubArg = (arg: unknown): unknown => {
      if (typeof arg === "string") return scrubString(arg);
      if (arg instanceof Error) {
        const cloned = new Error(scrubString(arg.message));
        cloned.name = arg.name;
        if (arg.stack) cloned.stack = scrubString(arg.stack);
        return cloned;
      }
      return arg;
    };

    const wrap =
      (fn: (...args: unknown[]) => void) => (...args: unknown[]): void => {
        fn(...args.map(scrubArg));
      };

    const originalError = console.error.bind(console);
    const originalWarn = console.warn.bind(console);
    console.error = wrap(originalError);
    console.warn = wrap(originalWarn);
  }
}

/** Syncs the resolved theme to `data-theme` on `<html>` and listens for OS color-scheme changes. */
function ThemeSync() {
  const theme = useTheme();

  createEffect(() => {
    document.documentElement.setAttribute("data-theme", theme.resolvedTheme);
  });

  createEffect(() => {
    const mq = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      theme.setSystemTheme(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", handler);
    onCleanup(() => mq.removeEventListener("change", handler));
  });

  return null;
}

/** Mirrors the active UI language to the `lang` attribute on `<html>` (WCAG 3.1.1). */
function LangSync() {
  const i18n = useI18n();

  createEffect(() => {
    document.documentElement.lang = i18n.lang;
  });

  return null;
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element '#root' not found");
}

render(() => (
  <>
    <ThemeSync />
    <LangSync />
    <Router explicitLinks root={App}>
      <AppRoutes />
    </Router>
  </>
), rootElement);
