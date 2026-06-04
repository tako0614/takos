import { createEffect, type JSX } from "solid-js";
import AuthGuard from "./AuthGuard.tsx";
import type { SessionRecord } from "../../lib/session.ts";

interface Props {
  /**
   * Document title. The repeated dashboard pattern always appends
   * " — Takosumi", so pass only the page-specific prefix. Omit on routes
   * that set the title dynamically inside their body.
   */
  title?: string;
  children: (session: SessionRecord) => JSX.Element;
}

/**
 * Shared auth-gated page preamble for the account screens. Behaviour mirrors
 * the dashboard `Page`: set the document title (when given), then AuthGuard
 * handles the session probe / spinner / sign-in redirect and only invokes
 * `children` with a live session once authenticated.
 *
 * The takos web SPA does not depend on `@solidjs/meta`, so the title is set
 * imperatively via `document.title` instead of `<Title>`.
 *
 * Ported from takosumi dashboard-ui/src/components/auth/Page.tsx.
 */
export default function Page(props: Props) {
  createEffect(() => {
    if (props.title && typeof document !== "undefined") {
      document.title = `${props.title} — Takosumi`;
    }
  });
  return <AuthGuard>{(session) => props.children(session)}</AuthGuard>;
}
