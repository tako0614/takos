import { type ReactNode } from 'react';
import { Icons } from '../../../lib/Icons';
import type { Resource } from '../../../types';

export function getResourceTypeIcon(type: Resource['type']): ReactNode {
  switch (type) {
    case 'd1':
      return <Icons.Database />;
    case 'r2':
      return <Icons.Bucket />;
    case 'kv':
      return <Icons.Key />;
    case 'vectorize':
      return <Icons.Search />;
    case 'worker':
      return <Icons.Server />;
    default:
      return <Icons.Database />;
  }
}

export function getResourceTypeName(type: Resource['type']): string {
  switch (type) {
    case 'd1':
      return 'D1 Database';
    case 'r2':
      return 'R2 Storage';
    case 'kv':
      return 'KV Store';
    case 'vectorize':
      return 'Vectorize';
    case 'worker':
      return 'Worker';
    default:
      return type;
  }
}

export function getResourceStatusBgClass(status: Resource['status']): string {
  switch (status) {
    case 'active':
      return 'bg-zinc-900';
    case 'creating':
      return 'bg-zinc-500';
    case 'error':
      return 'bg-zinc-400';
    default:
      return 'bg-zinc-300';
  }
}
