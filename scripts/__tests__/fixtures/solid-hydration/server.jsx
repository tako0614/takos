import { generateHydrationScript, renderToStringAsync } from "solid-js/web";
import Workspace from "./Workspace.jsx";

export async function renderWorkspace() {
  const body = await renderToStringAsync(() => <Workspace />, {
    renderId: "workspace-",
  });
  return `<html><head>${generateHydrationScript()}</head><body><main id="root">${body}</main></body></html>`;
}
