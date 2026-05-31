import type { RouteState } from "../../types/index.ts";

export function normalizeUsernameInput(value: string): string {
  return value.toLowerCase().replace(/^@+/, "").replace(/[^a-z0-9_-]/g, "");
}

export function syncRouteWithUsernameChange(
  route: RouteState,
  previousUsername: string,
  nextUsername: string,
): RouteState {
  if (
    !previousUsername || !nextUsername || route.username !== previousUsername
  ) {
    return route;
  }

  if (route.view !== "profile" && route.view !== "repo") {
    return route;
  }

  return {
    ...route,
    username: nextUsername,
  };
}
