import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildNodeApp } from "../../scripts/build-node-app.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

await buildNodeApp({
  appDir: __dirname,
  loader: {
    ".md": "text",
  },
});
