import { assertThrows } from "jsr:@std/assert";
import { BadRequestError } from "takos-common/errors";

import { resolveContainerImageArtifact } from "../group-deployment-snapshot-artifacts.ts";

Deno.test(
  "resolveContainerImageArtifact rejects dockerfile-only attached containers for group deployment snapshots",
  () => {
    assertThrows(
      () =>
        resolveContainerImageArtifact(
          "sandbox",
          "container",
          {
            kind: "attached-container",
            dockerfile: "./containers/sandbox.Dockerfile",
          } as any,
        ),
      BadRequestError,
      "requires compute.image",
    );
  },
);
