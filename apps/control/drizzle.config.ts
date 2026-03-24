import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: '../../packages/control/src/infra/db/schema.ts',
  out: './db/migrations',
  dialect: 'sqlite',
});
