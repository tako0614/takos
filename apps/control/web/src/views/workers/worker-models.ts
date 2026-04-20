export type WorkerDetailTab = "overview" | "deployments" | "settings";
export type WorkerSettingsTab =
  | "general"
  | "domains"
  | "env"
  | "bindings"
  | "runtime";
export type ResourceDetailTab =
  | "overview"
  | "explorer"
  | "browser"
  | "bindings"
  | "settings";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type D1Row = Record<string, JsonValue>;
export interface D1TableData {
  columns: string[];
  rows: D1Row[];
}
export type D1QueryResult = JsonValue;

export interface EnvVar {
  name: string;
  value: string;
  type: "plain_text" | "secret_text";
}

export interface Binding {
  id?: string;
  type: string;
  name: string;
  resource_id?: string;
  resource_name?: string | null;
}

export interface RuntimeConfig {
  compatibility_date?: string;
  compatibility_flags?: string[];
  cpu_ms?: number;
  subrequests?: number;
}

export interface WorkerDomain {
  id: string;
  domain: string;
  status: string;
  verification_method: string;
  verification_token?: string;
}

export interface VerificationInfo {
  method: string;
  record: string;
  target: string;
  instructions: string;
}
