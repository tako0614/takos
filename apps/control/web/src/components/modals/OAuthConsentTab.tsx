import { createSignal, onMount } from "solid-js";
import { For, Show } from "solid-js";
import type { OAuthConsent } from "./OAuthSettingsModal.tsx";
import { useI18n } from "../../store/i18n.ts";
import { useConfirmDialog } from "../../store/confirm-dialog.ts";
import { rpc, rpcJson } from "../../lib/rpc.ts";
import { formatShortDate } from "../../lib/format.ts";
import { toSafeHref } from "../../lib/safeHref.ts";
import { Icons } from "../../lib/Icons.tsx";
import { Card } from "../ui/Card.tsx";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";

/**
 * Frontend-local scope descriptions. The authoritative scope list lives in
 * src/types/oauth.ts (OAUTH_SCOPES). Keep these two in sync.
 */
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: "OpenID Connect identity",
  profile: "Read your profile information",
  email: "Read your email address",
  "spaces:read": "Read your workspaces",
  "spaces:write": "Create and modify workspaces",
  "files:read": "Read files in workspaces",
  "files:write": "Create and modify files",
  "memories:read": "Read memories",
  "memories:write": "Create and modify memories",
  "threads:read": "Read chat threads",
  "threads:write": "Create and send messages",
  "agents:execute": "Execute AI agents",
  "repos:read": "Read repositories",
  "repos:write": "Create and modify repositories",
};

interface OAuthConsentTabProps {
  loading: boolean;
  onLoadingChange: (loading: boolean) => void;
}

export function OAuthConsentTab(props: OAuthConsentTabProps) {
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();
  const [consents, setConsents] = createSignal<OAuthConsent[]>([]);
  const [revoking, setRevoking] = createSignal<string | null>(null);

  onMount(() => {
    fetchConsents();
  });

  async function fetchConsents(): Promise<void> {
    props.onLoadingChange(true);
    try {
      const res = await rpc.me.oauth.consents.$get();
      const data = await rpcJson<{ consents: OAuthConsent[] }>(res);
      setConsents(data.consents || []);
    } catch (err) {
      console.error("Failed to fetch consents:", err);
    } finally {
      props.onLoadingChange(false);
    }
  }

  async function handleRevokeConsent(clientId: string): Promise<void> {
    const confirmed = await confirm({
      title: t("revokeAccess"),
      message: t("revokeConfirm"),
      confirmText: t("revokeAccess"),
      danger: true,
    });
    if (!confirmed) return;
    setRevoking(clientId);
    try {
      const res = await rpc.me.oauth.consents[":clientId"].$delete({
        param: { clientId },
      });
      await rpcJson(res);
      setConsents((prev) => prev.filter((c) => c.client_id !== clientId));
    } catch (err) {
      console.error("Failed to revoke:", err);
    } finally {
      setRevoking(null);
    }
  }

  return (
    <Show when={!props.loading}>
      <div>
        <p
          style={{
            "font-size": "0.875rem",
            color: "var(--color-text-secondary)",
            "margin-bottom": "1rem",
          }}
        >
          {t("authorizedAppsDesc")}
        </p>
        <Show
          when={consents().length > 0}
          fallback={
            <div
              style={{
                "text-align": "center",
                padding: "3rem 0",
                color: "var(--color-text-tertiary)",
              }}
            >
              <Icons.Key
                style={{
                  width: "3rem",
                  height: "3rem",
                  margin: "0 auto 1rem",
                  opacity: 0.5,
                }}
              />
              <p
                style={{
                  "font-weight": 500,
                  color: "var(--color-text-primary)",
                  margin: "0",
                }}
              >
                {t("noAuthorizedApps")}
              </p>
              <p style={{ "font-size": "0.875rem", "margin-top": "0.25rem" }}>
                {t("noAuthorizedAppsDesc")}
              </p>
            </div>
          }
        >
          <div
            style={{
              display: "flex",
              "flex-direction": "column",
              gap: "0.75rem",
            }}
          >
            <For each={consents()}>
              {(consent) => {
                const safeClientUri = toSafeHref(consent.client_uri);
                return (
                  <Card>
                    <div
                      style={{
                        display: "flex",
                        "align-items": "flex-start",
                        gap: "1rem",
                      }}
                    >
                      <div
                        style={{
                          width: "2.5rem",
                          height: "2.5rem",
                          "border-radius": "var(--radius-lg)",
                          "background-color": "var(--color-surface-secondary)",
                          display: "flex",
                          "align-items": "center",
                          "justify-content": "center",
                        }}
                      >
                        <Show
                          when={consent.client_logo}
                          fallback={
                            <Icons.Code
                              style={{
                                width: "1.25rem",
                                height: "1.25rem",
                                color: "var(--color-text-tertiary)",
                              }}
                            />
                          }
                        >
                          <img
                            src={consent.client_logo!}
                            alt={consent.client_name + " logo"}
                            style={{
                              width: "2rem",
                              height: "2rem",
                              "border-radius": "var(--radius-md)",
                            }}
                          />
                        </Show>
                      </div>
                      <div style={{ flex: 1, "min-width": "0" }}>
                        <div
                          style={{
                            display: "flex",
                            "align-items": "center",
                            gap: "0.5rem",
                          }}
                        >
                          <h4
                            style={{
                              "font-weight": 500,
                              color: "var(--color-text-primary)",
                              margin: "0",
                            }}
                          >
                            {consent.client_name}
                          </h4>
                          <Show when={safeClientUri}>
                            <a
                              href={safeClientUri!}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: "var(--color-text-primary)" }}
                              aria-label={`${consent.client_name} - ${
                                t("openInNewTab")
                              }`}
                            >
                              <Icons.ExternalLink
                                style={{ width: "1rem", height: "1rem" }}
                              />
                            </a>
                          </Show>
                        </div>
                        <p
                          style={{
                            "font-size": "0.75rem",
                            color: "var(--color-text-tertiary)",
                            "margin-top": "0.25rem",
                          }}
                        >
                          {t("grantedOn")}:{" "}
                          {formatShortDate(consent.granted_at)}
                        </p>
                        <div
                          style={{
                            display: "flex",
                            "flex-wrap": "wrap",
                            gap: "0.25rem",
                            "margin-top": "0.5rem",
                          }}
                        >
                          <For each={consent.scopes}>
                            {(scope) => (
                              <Badge
                                variant="default"
                                title={SCOPE_DESCRIPTIONS[scope] || scope}
                              >
                                {scope}
                              </Badge>
                            )}
                          </For>
                        </div>
                      </div>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleRevokeConsent(consent.client_id)}
                        disabled={revoking() === consent.client_id}
                        isLoading={revoking() === consent.client_id}
                      >
                        {t("revokeAccess")}
                      </Button>
                    </div>
                  </Card>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
