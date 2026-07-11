import mcpRoutes from "./routes.ts";
import clientMetadataRoutes from "./client-metadata.ts";

// Keep public client metadata separate from authenticated registry/server
// routes so the deployment-specific HTTPS client_id remains fetchable by an
// external OAuth authorization server.
mcpRoutes.route("/", clientMetadataRoutes);

export default mcpRoutes;
export * from "./routes.ts";
