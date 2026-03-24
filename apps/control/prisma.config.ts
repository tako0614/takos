/**
 * Prisma Configuration for Takos Private
 *
 * This configures Prisma for development. In production, we use the D1 adapter
 * directly in the worker code.
 */
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // For local development, use SQLite. In production, we use D1 adapter.
    url: process.env["DATABASE_URL"] || "file:./prisma/dev.db",
  },
});
