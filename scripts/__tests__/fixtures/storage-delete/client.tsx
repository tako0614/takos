import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { StoragePage } from "../../../../web/src/views/storage/StoragePage.tsx";
import { ConfirmDialogRenderer } from "../../../../web/src/components/common/ConfirmDialog.tsx";
import { useToast } from "../../../../web/src/store/toast.ts";

const [space, setSpace] = createSignal("space-a");
const [path, setPath] = createSignal("/a");
const toast = useToast();
const dispose = render(() => <>
  <StoragePage spaceId={space()} spaces={[]} initialPath={path()} />
  <ConfirmDialogRenderer />
</>, document.getElementById("root")!);

Object.assign(window, { storageDeleteFixture: {
  setSpace, setPath, dispose, toasts: () => toast.toasts,
  clearToasts: () => { for (const item of toast.toasts) toast.dismissToast(item.id); },
} });
