import type { JSX } from "solid-js";
import { ConfirmDialogRenderer } from "./components/common/ConfirmDialog.tsx";
import { ToastRenderer } from "./components/common/Toast.tsx";
import { AppModals } from "./components/layout/AppModals.tsx";
import { rpc, rpcJson } from "./lib/rpc.ts";
import { getErrorMessage } from "./lib/errors.ts";
import { getSpaceIdentifier } from "./lib/spaces.ts";
import type { Space } from "./types/index.ts";
import { AuthProvider, useAuth } from "./hooks/useAuth.tsx";
import { ModalProvider, useModals } from "./store/modal.tsx";
import { NavigationProvider, useNavigation } from "./store/navigation.ts";
import { useI18n } from "./store/i18n.ts";

function AppShell(props: { children: JSX.Element }) {
  const auth = useAuth();
  const modal = useModals();
  const navigation = useNavigation();
  const i18n = useI18n();

  const handleCreateSpace = async (
    name: string,
    description: string,
    installDefaultApps: boolean,
  ) => {
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    let space: Space;

    try {
      const response = await rpc.spaces.$post({
        json: {
          name: trimmedName,
          description: trimmedDescription || undefined,
          installDefaultApps,
        },
      });
      const data = await rpcJson<{ space: Space }>(response);
      space = data.space;
    } catch (error) {
      throw new Error(
        getErrorMessage(
          error,
          i18n.t("failedToCreate") || "Failed to create",
        ),
      );
    }

    try {
      await auth.fetchSpaces(auth.user, {
        notifyOnError: false,
        throwOnError: true,
      });
    } catch (error) {
      throw new Error(
        getErrorMessage(error, i18n.t("failedToLoad") || "Failed to load"),
      );
    }

    modal.setShowCreateSpace(false);
    navigation.navigateToChat(getSpaceIdentifier(space));
  };

  return (
    <>
      {props.children}
      <AppModals onCreateSpace={handleCreateSpace} />
      <ConfirmDialogRenderer />
      <ToastRenderer />
    </>
  );
}

function App(props: { children: JSX.Element }) {
  return (
    <AuthProvider>
      <ModalProvider>
        <NavigationProvider>
          <AppShell>{props.children}</AppShell>
        </NavigationProvider>
      </ModalProvider>
    </AuthProvider>
  );
}

export default App;
