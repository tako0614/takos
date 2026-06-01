{{/*
Expand the name of the chart.
*/}}
{{- define "takos.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this
(by the DNS naming spec). If release name contains chart name it will be used
as a full name.
*/}}
{{- define "takos.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "takos.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "takos.labels" -}}
helm.sh/chart: {{ include "takos.chart" . }}
{{ include "takos.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: takos
{{- end }}

{{/*
Selector labels
*/}}
{{- define "takos.selectorLabels" -}}
app.kubernetes.io/name: {{ include "takos.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use.
*/}}
{{- define "takos.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "takos.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/* ================================================================
     Image helpers
     ================================================================ */}}

{{/*
Render an image reference from per-service image values. global.imageRegistry
overrides image.registry when set by an operator overlay.
Fails at template render time if tag is empty — CI must set a concrete image tag.
*/}}
{{- define "takos.image" -}}
{{- $root := .root -}}
{{- $image := .image -}}
{{- $registry := default $image.registry $root.Values.global.imageRegistry -}}
{{- $repository := required "image.repository is required" $image.repository -}}
{{- if not $image.tag -}}
{{- fail (printf "image.tag must not be empty for repository %s — CI release pipeline must set a concrete tag" $repository) -}}
{{- end -}}
{{- $tag := $image.tag -}}
{{- if $registry -}}
{{- printf "%s/%s:%s" ($registry | trimSuffix "/") ($repository | trimPrefix "/") $tag -}}
{{- else -}}
{{- printf "%s:%s" $repository $tag -}}
{{- end -}}
{{- end }}

{{/* ================================================================
     Internal service URL helpers
     ================================================================ */}}

{{/*
Takos worker internal URL
*/}}
{{- define "takos.workerUrl" -}}
{{- printf "http://%s-takos-worker:%v" (include "takos.fullname" .) (int .Values.services.takosWorker.port) }}
{{- end }}

{{/*
Takosumi internal URL
*/}}
{{- define "takos.takosumiUrl" -}}
{{- printf "http://%s-takosumi:%v" (include "takos.fullname" .) (int .Values.services.takosumi.port) }}
{{- end }}

{{/*
Takosumi Accounts internal URL
*/}}
{{- define "takos.accountsUrl" -}}
{{- printf "http://%s-takosumi-accounts:%v" (include "takos.fullname" .) (int .Values.services.takosumiAccounts.port) }}
{{- end }}

{{/*
Takosumi Accounts public issuer URL
*/}}
{{- define "takos.accountsIssuer" -}}
{{- default (printf "https://%s" .Values.domains.accounts) .Values.accounts.issuer }}
{{- end }}

{{/*
Takos OIDC redirect URI registered with Takosumi Accounts
*/}}
{{- define "takos.oidcRedirectUri" -}}
{{- default (printf "https://%s/auth/oidc/callback" .Values.domains.admin) .Values.accounts.redirectUri }}
{{- end }}

{{/*
Secret containing the Takosumi Accounts Postgres connection URL.
*/}}
{{- define "takos.accountsDatabaseSecretName" -}}
{{- default (.Values.secrets.existingSecrets.platform | default (printf "%s-platform" (include "takos.fullname" .))) .Values.accounts.persistence.databaseUrlSecretName }}
{{- end }}

{{/*
Takos Git hosting internal URL
*/}}
{{- define "takos.gitUrl" -}}
{{- printf "http://%s-takos-git:%v" (include "takos.fullname" .) (int .Values.services.takosGit.port) }}
{{- end }}

{{/*
Takos agent service internal URL
*/}}
{{- define "takos.agentUrl" -}}
{{- printf "http://%s-takos-agent:%v" (include "takos.fullname" .) (int .Values.services.takosAgent.port) }}
{{- end }}
