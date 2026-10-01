export {};

const [entrypoint, outdir, wranglerConfigPath] = process.argv.slice(2);
if (!entrypoint || !outdir || !wranglerConfigPath) {
  throw new Error("usage: build-native-proof-fixture.ts <entrypoint> <outdir> <wrangler.toml>");
}
const wranglerConfig = Bun.TOML.parse(await Bun.file(wranglerConfigPath).text()) as {
  compatibility_date?: unknown;
  compatibility_flags?: unknown;
};
if (typeof wranglerConfig.compatibility_date !== "string" ||
  !Array.isArray(wranglerConfig.compatibility_flags) ||
  !wranglerConfig.compatibility_flags.every((flag) => typeof flag === "string")) {
  throw new Error("Wrangler compatibility_date/compatibility_flags are missing or invalid");
}
const built = await Bun.build({
  entrypoints: [entrypoint],
  outdir,
  target: "browser",
  external: ["cloudflare:*", "node:*"],
  minify: false,
  metafile: true,
});
const metafile = built.metafile ?? null;
process.stdout.write(JSON.stringify({
  success: built.success,
  outputs: built.outputs.map((output) => ({ path: output.path })),
  logs: built.logs.map(String),
  metafile,
  bunVersion: Bun.version,
  compatibilityDate: wranglerConfig.compatibility_date,
  compatibilityFlags: wranglerConfig.compatibility_flags,
}));
