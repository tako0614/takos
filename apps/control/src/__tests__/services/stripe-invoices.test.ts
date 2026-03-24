import { afterEach, describe, expect, it, vi } from 'vitest';
import { listInvoices, retrieveInvoice, sendInvoice } from '@/services/billing/stripe';

describe('stripe invoice helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listInvoices calls Stripe API with customer and limit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'in_1', customer: 'cus_1' }], has_more: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await listInvoices({
      secretKey: 'sk_test',
      customerId: 'cus_1',
      limit: 10,
    });

    expect(result).toEqual({
      invoices: [{ id: 'in_1', customer: 'cus_1' }],
      has_more: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/invoices?customer=cus_1&limit=10',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk_test',
        }),
      })
    );
  });

  it('retrieveInvoice calls Stripe API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'in_1', customer: 'cus_1' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(
      retrieveInvoice({ secretKey: 'sk_test', invoiceId: 'in_1' })
    ).resolves.toEqual({ id: 'in_1', customer: 'cus_1' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/invoices/in_1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk_test',
        }),
      })
    );
  });

  it('sendInvoice posts to Stripe send endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'in_1', customer: 'cus_1' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(
      sendInvoice({ secretKey: 'sk_test', invoiceId: 'in_1' })
    ).resolves.toEqual({ id: 'in_1', customer: 'cus_1' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/invoices/in_1/send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk_test',
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
        body: '',
      })
    );
  });
});

