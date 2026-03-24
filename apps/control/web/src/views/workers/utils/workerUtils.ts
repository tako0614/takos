import type { Worker } from '../../../types';

export function getWorkerDisplayName(worker: Pick<Worker, 'id' | 'slug' | 'service_name'>): string {
  return worker.slug?.trim() || worker.service_name?.trim() || worker.id;
}

export function getWorkerDisplayHostname(worker: Pick<Worker, 'hostname'>): string {
  return worker.hostname?.trim() || '-';
}

export function getWorkerUrl(worker: Pick<Worker, 'hostname'>): string | null {
  const hostname = worker.hostname?.trim();
  return hostname ? `https://${hostname}` : null;
}

export function getWorkerStatusBgClass(status: Worker['status']): string {
  switch (status) {
    case 'deployed':
      return 'bg-zinc-900 dark:bg-zinc-100';
    case 'pending':
    case 'building':
      return 'bg-zinc-500';
    case 'stopped':
      return 'bg-zinc-400 dark:bg-zinc-500';
    case 'failed':
      return 'bg-zinc-300 dark:bg-zinc-600';
    default:
      return 'bg-zinc-500';
  }
}

export function getWorkerStatusIndicatorClass(status: Worker['status']): string {
  switch (status) {
    case 'deployed':
      return 'bg-zinc-900 dark:bg-zinc-100';
    case 'failed':
      return 'border border-zinc-900 dark:border-zinc-100 bg-transparent';
    case 'stopped':
      return 'bg-zinc-300 dark:bg-zinc-600';
    case 'pending':
    case 'building':
    default:
      return 'bg-zinc-400 animate-pulse';
  }
}
