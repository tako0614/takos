import { render } from "solid-js/web";
import { SharedThreadPage } from "../../../../web/src/views/share/SharedThreadPage.tsx";

const host = globalThis as unknown as {
  takosShareToken: string;
  takosShareFixture: { dispose: () => void };
};
host.takosShareFixture = {
  dispose: render(() => <SharedThreadPage token={host.takosShareToken} />, document.getElementById("root")!),
};
