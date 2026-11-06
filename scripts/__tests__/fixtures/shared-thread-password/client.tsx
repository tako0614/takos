import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { SharedThreadPage } from "../../../../web/src/views/share/SharedThreadPage.tsx";

const host = globalThis as unknown as {
  takosShareToken: string;
  takosShareFixture: { dispose: () => void; setToken: (token: string) => void };
};
// ShareRoute passes a reactive token accessor to the same page instance.
const [token, setToken] = createSignal(host.takosShareToken);
host.takosShareFixture = {
  dispose: render(() => <SharedThreadPage token={token()} />, document.getElementById("root")!),
  setToken,
};
