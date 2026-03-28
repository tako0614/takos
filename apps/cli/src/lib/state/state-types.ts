export interface TakosState {
  version: 1;
  provider: string; // 'cloudflare' | 'aws' | 'gcp' | 'k8s' | 'docker'
  env: string;
  groupName: string;
  updatedAt: string;
  resources: Record<string, ResourceState>;
  workers: Record<string, WorkerState>;
  containers: Record<string, ContainerState>;
  services: Record<string, ServiceState>;
}

export interface ResourceState {
  type: string; // 'd1' | 'r2' | 'kv' | 'queue' | etc
  id: string;
  binding: string;
  createdAt: string;
}

export interface WorkerState {
  scriptName: string;
  deployedAt: string;
  codeHash: string; // ソースコードのハッシュ
  containers?: string[]; // 紐づく CF Containers
}

export interface ContainerState {
  deployedAt: string;
  imageHash: string;
}

export interface ServiceState {
  deployedAt: string;
  imageHash: string;
  ipv4?: string;
}
