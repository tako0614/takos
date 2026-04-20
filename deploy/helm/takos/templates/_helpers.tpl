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
     Data-store URL helpers
     ================================================================ */}}

{{/*
Database URL - prefer externalDatabase.url, then build from subchart or
external host/port/credentials.
*/}}
{{- define "takos.databaseUrl" -}}
{{- if .Values.externalDatabase.url }}
{{- .Values.externalDatabase.url }}
{{- else if .Values.postgresql.enabled }}
{{- printf "postgresql://%s:%s@%s-postgresql:5432/%s" .Values.postgresql.auth.username .Values.postgresql.auth.password (include "takos.fullname" .) .Values.postgresql.auth.database }}
{{- else }}
{{- printf "postgresql://%s:%s@%s:%v/%s" .Values.externalDatabase.username .Values.externalDatabase.password .Values.externalDatabase.host (int .Values.externalDatabase.port) .Values.externalDatabase.database }}
{{- end }}
{{- end }}

{{/*
Redis URL - prefer externalRedis.url, then build from subchart or external
host/port/credentials.
*/}}
{{- define "takos.redisUrl" -}}
{{- if .Values.externalRedis.url }}
{{- .Values.externalRedis.url }}
{{- else if .Values.redis.enabled }}
{{- printf "redis://%s-redis-master:6379" (include "takos.fullname" .) }}
{{- else if .Values.externalRedis.password }}
{{- printf "redis://:%s@%s:%v" .Values.externalRedis.password .Values.externalRedis.host (int .Values.externalRedis.port) }}
{{- else }}
{{- printf "redis://%s:%v" .Values.externalRedis.host (int .Values.externalRedis.port) }}
{{- end }}
{{- end }}

{{/*
S3 endpoint - prefer subchart MinIO, then externalS3.endpoint.
*/}}
{{- define "takos.s3Endpoint" -}}
{{- if .Values.minio.enabled }}
{{- printf "http://%s-minio:9000" (include "takos.fullname" .) }}
{{- else }}
{{- .Values.externalS3.endpoint }}
{{- end }}
{{- end }}

{{/* ================================================================
     Internal service URL helpers
     ================================================================ */}}

{{/*
Control Web internal URL
*/}}
{{- define "takos.controlWebUrl" -}}
{{- printf "http://%s-control-web:%v" (include "takos.fullname" .) (int .Values.controlWeb.port) }}
{{- end }}

{{/*
Control Dispatch internal URL
*/}}
{{- define "takos.controlDispatchUrl" -}}
{{- printf "http://%s-control-dispatch:%v" (include "takos.fullname" .) (int .Values.controlDispatch.port) }}
{{- end }}

{{/*
Runtime Host internal URL
*/}}
{{- define "takos.runtimeHostUrl" -}}
{{- printf "http://%s-runtime-host:%v" (include "takos.fullname" .) (int .Values.runtimeHost.port) }}
{{- end }}

{{/*
Executor Host internal URL
*/}}
{{- define "takos.executorHostUrl" -}}
{{- printf "http://%s-executor-host:%v" (include "takos.fullname" .) (int .Values.executorHost.port) }}
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
