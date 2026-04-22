import { parseAppManifestYaml } from "../packages/control/src/application/services/source/app-manifest.ts";

const paths = Deno.args;

if (paths.length === 0) {
  console.error(
    "usage: deno task --cwd scripts validate-external-manifests <manifest-path>...",
  );
  Deno.exit(1);
}

for (const manifestPath of paths) {
  const text = await Deno.readTextFile(manifestPath);
  parseAppManifestYaml(text);
  console.log(`ok: ${manifestPath}`);
}
