import { assertEquals } from "jsr:@std/assert";
import {
  formatAppStatusLabel,
  formatAppTypeLabel,
  getAppStatusVariant,
  loadRegisteredApps,
} from "../../../views/apps/registered-apps.ts";

Deno.test(
  "registered apps - requests the current space inventory with the space header",
  async () => {
    let capturedHeaders: HeadersInit | undefined;

    const apps = await loadRegisteredApps("space-123", async (_input, init) => {
      capturedHeaders = init?.headers;
      return new Response(
        JSON.stringify({
          apps: [{
            id: "app-1",
            name: "Docs",
            description: "Docs app",
            icon: "D",
            app_type: "custom",
            url: "/apps/docs",
            space_id: "space-123",
            space_name: "Personal",
            service_hostname: "docs.example.com",
            service_status: "deployed",
          }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    assertEquals(
      new Headers(capturedHeaders).get("X-Takos-Space-Id"),
      "space-123",
    );
    assertEquals(apps, [{
      id: "app-1",
      name: "Docs",
      description: "Docs app",
      icon: "D",
      app_type: "custom",
      url: "/apps/docs",
      space_id: "space-123",
      space_name: "Personal",
      service_hostname: "docs.example.com",
      service_status: "deployed",
    }]);
  },
);

Deno.test("registered apps - formats app labels and status variants", () => {
  assertEquals(formatAppTypeLabel("platform"), "Platform");
  assertEquals(formatAppTypeLabel("custom"), "Custom");
  assertEquals(formatAppStatusLabel("pending_queue"), "Pending Queue");
  assertEquals(getAppStatusVariant("deployed"), "success");
  assertEquals(getAppStatusVariant("failed"), "error");
  assertEquals(getAppStatusVariant("pending_queue"), "warning");
});
