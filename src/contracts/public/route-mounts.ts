// Route families that serve real subroutes, for the docs-shape R2 check
// (takos-control docs-shape.json routeInventory.mounts). A mount entry
// vouches for documented paths at or below it — e.g. docs may describe the
// index family as "/api/spaces/:spaceId/index*" without naming each child.
// Add a family here only when it has real endpoints underneath; a family
// with no children is not a mount, it is a missing route.
export const TAKOS_API_ROUTE_MOUNTS: readonly string[] = [
  "/api/spaces/:spaceId/index",
];
