import { createMemo } from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import type { RouteState } from "../types/index.ts";
import {
  buildPath,
  normalizeNavigationState,
  parseRoute,
  shouldPushHistory,
} from "./router-state.ts";

export {
  buildPath,
  normalizeNavigationState,
  parseRoute,
  shouldPushHistory,
} from "./router-state.ts";

export function useRouteState() {
  const location = useLocation();
  return createMemo<RouteState>(() =>
    parseRoute(location.pathname, location.search)
  );
}

export function useRouter() {
  const location = useLocation();
  const navigateWithRouter = useNavigate();
  const route = useRouteState();

  const navigate = (newState: Partial<RouteState>) => {
    const merged = normalizeNavigationState(route(), newState);
    const nextPath = buildPath(merged);
    if (!shouldPushHistory(location.pathname, location.search, nextPath)) {
      return;
    }
    navigateWithRouter(nextPath, { resolve: false, scroll: false });
  };

  const replace = (newState: RouteState) => {
    navigateWithRouter(buildPath(newState), {
      resolve: false,
      replace: true,
      scroll: false,
    });
  };

  return {
    get route() {
      return route();
    },
    navigate,
    replace,
  };
}
