import solid from "vite-plugin-solid";
import { createTauriMobileViteConfig } from "../../takosumi/mobile-kit/src/vite.ts";

const devPort = 1420;

export default createTauriMobileViteConfig({
  devPort,
  importMetaUrl: import.meta.url,
  plugins: [solid()],
});
