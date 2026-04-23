import { assertRejects } from "jsr:@std/assert";
import { BadRequestError } from "takos-common/errors";

import type { Env } from "../../../../shared/types/index.ts";
import { GroupDeploymentSnapshotService } from "../group-deployment-snapshots.ts";

Deno.test("GroupDeploymentSnapshotService rejects targeted group source deploys", async () => {
  const env = {
    DB: {} as Env["DB"],
    TENANT_SOURCE: {} as never,
    GIT_OBJECTS: {} as never,
  } as unknown as Env;
  const service = new GroupDeploymentSnapshotService(env);

  await assertRejects(
    () =>
      service.deployFromManifest("space-1", "user-1", {
        groupName: "demo",
        manifest: {
          name: "demo",
          compute: {},
          routes: [],
          publish: [],
          env: {},
        },
        targets: ["web"],
      }),
    BadRequestError,
    "Targeted group source deploys are not supported",
  );
});

Deno.test("GroupDeploymentSnapshotService requires a group name only when the manifest omits name", async () => {
  const env = {
    DB: {} as Env["DB"],
    TENANT_SOURCE: {} as never,
    GIT_OBJECTS: {} as never,
  } as unknown as Env;
  const service = new GroupDeploymentSnapshotService(env);

  await assertRejects(
    () =>
      service.deployFromManifest("space-1", "user-1", {
        manifest: {
          name: "",
          compute: {},
          routes: [],
          publish: [],
          env: {},
        },
      } as never),
    BadRequestError,
    "group_name is required when the deploy manifest does not provide name",
  );
});

Deno.test("GroupDeploymentSnapshotService rejects invalid manifest-derived group names", async () => {
  const env = {
    DB: {} as Env["DB"],
    TENANT_SOURCE: {} as never,
    GIT_OBJECTS: {} as never,
  } as unknown as Env;
  const service = new GroupDeploymentSnapshotService(env);

  await assertRejects(
    () =>
      service.deployFromManifest("space-1", "user-1", {
        manifest: {
          name: "Bad Group",
          compute: {},
          routes: [],
          publish: [],
          env: {},
        },
      }),
    BadRequestError,
    "group_name must be 1-63 lowercase",
  );
});
