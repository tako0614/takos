import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/worker/infra/db/schema.ts",
  out: "./db/migrations-control/migrations",
  dialect: "sqlite",
});
