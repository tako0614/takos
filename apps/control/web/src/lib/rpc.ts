import { hc } from 'hono/client';
import type { ApiRoutes } from '../../../routes/rpc-types';

export const rpc = hc<ApiRoutes>('/api');


export class BillingQuotaError extends Error {
  code = 'BILLING_QUOTA_EXCEEDED' as const;
  reason: string;
  plan: string;
  constructor(data: { reason?: string; plan?: string }) {
    super(data.reason || 'Billing quota exceeded');
    this.reason = data.reason || 'Billing quota exceeded';
    this.plan = data.plan || '';
  }
}

export async function rpcJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as {
      error?: string;
      code?: string;
      reason?: string;
      plan?: string;
    };
    if (response.status === 401) {
      if (typeof window !== 'undefined') {
        const returnTo = `${window.location.pathname}${window.location.search}`;
        window.location.href = `/auth/login?return_to=${encodeURIComponent(returnTo)}`;
      }
      throw new Error(data.error || 'Authentication required');
    }
    if (response.status === 402 && data.code === 'BILLING_QUOTA_EXCEEDED') {
      throw new BillingQuotaError(data);
    }
    throw new Error(data.error || 'Request failed');
  }
  return response.json();
}

