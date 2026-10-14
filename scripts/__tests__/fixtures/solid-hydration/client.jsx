import { hydrate } from "solid-js/web";
import Workspace, { metrics } from "./Workspace.jsx";

globalThis.takosHydrationFixture = {
  metrics,
  dispose: hydrate(() => <Workspace />, document.getElementById("root"), {
    renderId: "workspace-",
  }),
};
