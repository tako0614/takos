import { Badge, Button, Card } from "../../components/ui/index.ts";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import type { McpRegistrySearchCandidate } from "../../types/index.ts";
import { getConnectionEndpointDisclosure } from "./connection-disclosure.ts";
import {
  getRegistryCandidateConnectionInfo,
  getRegistryNamespace,
  getSafeHttpsLink,
  registrySourceKindLabelKey,
} from "./registry-helpers.ts";

interface RegistryCandidateCardProps {
  candidate: McpRegistrySearchCandidate;
  onReview: (candidate: McpRegistrySearchCandidate) => void;
  onDeploy: (candidate: McpRegistrySearchCandidate) => void;
}

export function RegistryCandidateCard(props: RegistryCandidateCardProps) {
  const { t } = useI18n();
  const connectionInfo = () =>
    getRegistryCandidateConnectionInfo(props.candidate);
  const repositoryHref = () => getSafeHttpsLink(props.candidate.repository_url);
  const endpointDisclosure = () =>
    getConnectionEndpointDisclosure(connectionInfo().hostname);
  const displayTitle = () => props.candidate.title || props.candidate.name;
  const statusLabel = () => {
    switch (connectionInfo().status) {
      case "connectable":
        return t("reviewConnection");
      case "deployable":
        return t("registryDeployAsCapsule");
      case "deployment_unavailable":
        return t("registryCapsuleSourceRequired");
      case "configuration_required":
        return t("registryConfigurationRequired");
      case "unsupported_transport":
        return t("registryUnsupportedTransport");
      case "invalid_endpoint":
        return t("registryInvalidEndpoint");
    }
  };

  return (
    <Card padding="lg">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {displayTitle()}
              </h3>
              <Badge variant="info">
                {props.candidate.transport === "package"
                  ? t("registryDeployablePackage")
                  : "Streamable HTTP"}
              </Badge>
              <Badge variant="warning">{t("connectionTrustUnverified")}</Badge>
              <Badge variant="warning">{t("registryNoSafetyAssertion")}</Badge>
            </div>
            <p class="mt-1 break-all font-mono text-xs text-zinc-600 dark:text-zinc-400">
              {props.candidate.name}
            </p>
            <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {t("registryNamespace")}:{" "}
              {getRegistryNamespace(props.candidate.name)}
            </p>
          </div>
          <Button
            size="sm"
            disabled={
              connectionInfo().status !== "connectable" &&
              connectionInfo().status !== "deployable"
            }
            onClick={() =>
              connectionInfo().status === "deployable"
                ? props.onDeploy(props.candidate)
                : props.onReview(props.candidate)
            }
          >
            {statusLabel()}
          </Button>
        </div>

        {props.candidate.description ? (
          <p class="text-sm text-zinc-600 dark:text-zinc-300">
            {props.candidate.description}
          </p>
        ) : null}

        {connectionInfo().status === "configuration_required" ? (
          <div class="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            <Icons.AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t("registryConfigurationRequiredDescription")}</span>
          </div>
        ) : null}

        {props.candidate.transport === "package" ? (
          <div class="grid gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
            <p class="text-xs text-zinc-600 dark:text-zinc-300">
              {t("registryDeployableCapsuleBoundary")}
            </p>
            {props.candidate.packages.map((packageEntry) => (
              <div class="flex flex-wrap items-center gap-2 text-xs">
                <Badge>{packageEntry.registry_type.toUpperCase()}</Badge>
                <span class="break-all font-mono text-zinc-700 dark:text-zinc-200">
                  {packageEntry.identifier}
                  {packageEntry.version ? `@${packageEntry.version}` : ""}
                </span>
                <Badge variant="warning">{packageEntry.transport_type}</Badge>
              </div>
            ))}
          </div>
        ) : null}

        {props.candidate.transport === "streamable-http" ? (
          <dl class="grid gap-3 rounded-lg bg-zinc-50 p-4 text-sm dark:bg-zinc-800/50 sm:grid-cols-3">
            <CandidateDisclosureItem
              label={t("connectionEndpointDomain")}
              value={
                endpointDisclosure().endpointDomain ?? t("registryNotAvailable")
              }
            />
            <CandidateDisclosureItem
              label={t("connectionConnectorOperator")}
              value={
                endpointDisclosure().connectorOperator ??
                t("connectionUnknownUnverified")
              }
            />
            <CandidateDisclosureItem
              label={t("connectionDataSentTo")}
              value={
                endpointDisclosure().dataSentTo ?? t("registryNotAvailable")
              }
            />
          </dl>
        ) : null}

        <div class="flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            {t("registryVersion")}: {props.candidate.version}
          </span>
          {repositoryHref() ? (
            <a
              href={repositoryHref()!}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 font-medium text-sky-700 underline underline-offset-2 dark:text-sky-300"
            >
              {t("registryRepository")}
              <Icons.ExternalLink class="h-3 w-3" />
            </a>
          ) : null}
        </div>

        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {t("registryProvenance")}
          </p>
          <div class="mt-2 grid gap-2">
            {props.candidate.provenance.map((source) => (
              <div class="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
                <span class="font-medium text-zinc-800 dark:text-zinc-200">
                  {source.source_name}
                </span>
                <Badge>
                  {t(registrySourceKindLabelKey(source.source_kind))}
                </Badge>
                {source.preview ? (
                  <Badge variant="warning">{t("registryPreview")}</Badge>
                ) : null}
                {source.best_effort ? (
                  <Badge variant="warning">{t("registryBestEffort")}</Badge>
                ) : null}
                <span class="break-all font-mono text-zinc-500 dark:text-zinc-400">
                  {source.server_name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function CandidateDisclosureItem(props: { label: string; value: string }) {
  return (
    <div class="min-w-0">
      <dt class="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {props.label}
      </dt>
      <dd class="mt-1 truncate font-medium text-zinc-800 dark:text-zinc-200">
        {props.value}
      </dd>
    </div>
  );
}
