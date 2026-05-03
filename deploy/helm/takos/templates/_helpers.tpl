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
     Internal service URL helpers
     ================================================================ */}}

{{/*
PaaS API internal URL
*/}}
{{- define "takos.paasApiUrl" -}}
{{- printf "http://%s-paas-api:%v" (include "takos.fullname" .) (int .Values.paasApi.port) }}
{{- end }}

{{/*
PaaS router internal URL
*/}}
{{- define "takos.paasRouterUrl" -}}
{{- printf "http://%s-paas-router:%v" (include "takos.fullname" .) (int .Values.paasRouter.port) }}
{{- end }}

{{/*
PaaS runtime-agent internal URL
*/}}
{{- define "takos.paasRuntimeAgentUrl" -}}
{{- printf "http://%s-paas-runtime-agent:%v" (include "takos.fullname" .) (int .Values.paasRuntimeAgent.port) }}
{{- end }}

{{/*
PaaS log-worker internal URL
*/}}
{{- define "takos.paasLogWorkerUrl" -}}
{{- printf "http://%s-paas-log-worker:%v" (include "takos.fullname" .) (int .Values.paasLogWorker.port) }}
{{- end }}

{{/*
Runtime internal URL
*/}}
{{- define "takos.runtimeUrl" -}}
{{- printf "http://%s-runtime:%v" (include "takos.fullname" .) (int .Values.runtime.port) }}
{{- end }}

{{/*
Executor internal URL
*/}}
{{- define "takos.executorUrl" -}}
{{- printf "http://%s-executor:%v" (include "takos.fullname" .) (int .Values.executor.port) }}
{{- end }}

{{/*
OCI Orchestrator internal URL
*/}}
{{- define "takos.ociOrchestratorUrl" -}}
{{- printf "http://%s-oci-orchestrator:%v" (include "takos.fullname" .) (int .Values.ociOrchestrator.port) }}
{{- end }}
