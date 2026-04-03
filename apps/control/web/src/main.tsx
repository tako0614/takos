import { createEffect, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import { Router } from "@solidjs/router";
import App from "./App.tsx";
import { AppRoutes } from "./app-routes.tsx";
import { useTheme } from "./store/theme.ts";
import "./styles.css";

if (import.meta.env.PROD && import.meta.env.MODE !== "staging-debug") {
  const noop = () => {};
  console.debug = noop;
  console.log = noop;
  console.info = noop;
  console.warn = noop;
  console.error = noop;
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

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element '#root' not found");
}

render(() => (
  <>
    <ThemeSync />
    <Router explicitLinks root={App}>
      <AppRoutes />
    </Router>
  </>
), rootElement);
