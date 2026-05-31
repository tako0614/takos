import { assert, assertEquals, assertFalse } from "@std/assert";

import {
  _resetDeploymentControllersForTest,
  cancelDeployment,
  registerDeploymentController,
  unregisterDeploymentController,
} from "../cancellation-registry.ts";

Deno.test("registerDeploymentController returns a fresh non-aborted controller", () => {
  _resetDeploymentControllersForTest();
  const controller = registerDeploymentController("dep-1");
  assertFalse(controller.signal.aborted);
  unregisterDeploymentController("dep-1");
});

Deno.test("cancelDeployment aborts a registered controller and returns true", () => {
  _resetDeploymentControllersForTest();
  const controller = registerDeploymentController("dep-2");
  const triggered = cancelDeployment("dep-2", "user-initiated");
  assertEquals(triggered, true);
  assert(controller.signal.aborted);
  assertEquals(controller.signal.reason, "user-initiated");
  unregisterDeploymentController("dep-2");
});

Deno.test("cancelDeployment returns false for unregistered deployment", () => {
  _resetDeploymentControllersForTest();
  const triggered = cancelDeployment("nonexistent");
  assertEquals(triggered, false);
});

Deno.test("cancelDeployment returns false after unregister", () => {
  _resetDeploymentControllersForTest();
  registerDeploymentController("dep-3");
  unregisterDeploymentController("dep-3");
  const triggered = cancelDeployment("dep-3");
  assertEquals(triggered, false);
});

Deno.test("registerDeploymentController replaces an existing controller without aborting the prior", () => {
  _resetDeploymentControllersForTest();
  const first = registerDeploymentController("dep-4");
  const second = registerDeploymentController("dep-4");
  assert(first !== second);
  // The replaced controller is intentionally NOT aborted; tests document that
  // callers wanting fan-out should use combineSignals.
  assertFalse(first.signal.aborted);
  // Cancel hits the latest registration only.
  cancelDeployment("dep-4");
  assert(second.signal.aborted);
  assertFalse(first.signal.aborted);
  unregisterDeploymentController("dep-4");
});
