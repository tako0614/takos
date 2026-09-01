import { lazy, Show, type JSX } from "solid-js";
import { ToastRenderer } from "./components/common/Toast.tsx";
import { AuthProvider, useAuth } from "./hooks/useAuth.tsx";
import { ModalProvider } from "./store/modal.tsx";
import { NavigationProvider } from "./store/navigation.ts";

const AppModals = lazy(() =>
  import("./components/layout/AppModals.tsx").then((module) => ({
    default: module.AppModals,
  })),
);

function AppShell(props: { children?: JSX.Element }) {
  const auth = useAuth();

  return (
    <>
      {props.children}
      <Show when={auth.authState === "authenticated"}>
        <AppModals />
      </Show>
      <ToastRenderer />
    </>
  );
}

function App(props: { children?: JSX.Element }) {
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
