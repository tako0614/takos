import type { Hono } from "hono";
import { BadGatewayError, NotFoundError } from "takos-common/errors";
import type { Env } from "../../../shared/types/index.ts";
import type { BaseVariables } from "../route-auth.ts";
import { logError, logWarn } from "../../../shared/utils/logger.ts";
import type { NormalizedInvoice } from "../../../application/services/billing/payment-provider.ts";
import { billingRouteDeps } from "./deps.ts";
import {
  parseInvoiceListQuery,
  requirePaymentCustomerId,
} from "./helpers.ts";

type BillingRouter = Hono<{ Bindings: Env; Variables: BaseVariables }>;

function toInvoiceSummary(invoice: NormalizedInvoice) {
  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    currency: invoice.currency,
    amount_due: invoice.amountDueCents,
    amount_paid: invoice.amountPaidCents,
    total: invoice.totalCents,
    created: invoice.createdUnix,
    period_start: invoice.periodStartUnix,
    period_end: invoice.periodEndUnix,
    hosted_invoice_url: invoice.hostedUrl,
    invoice_pdf: invoice.pdfUrl,
  };
}

export function registerBillingInvoiceRoutes(app: BillingRouter) {
  app.get("/invoices", async (c) => {
    const provider = billingRouteDeps.resolvePaymentProvider(c.env);
    const { customerId } = await requirePaymentCustomerId(c);
    const { limit, startingAfter, endingBefore } = parseInvoiceListQuery(
      new URL(c.req.url),
    );

    try {
      const result = await provider.listInvoices({
        customerId,
        limit,
        startingAfter,
        endingBefore,
      });

      return c.json({
        invoices: result.invoices.map(toInvoiceSummary),
        has_more: result.hasMore,
      });
    } catch (err) {
      logError("listInvoices failed", err, { module: "billing" });
      throw new BadGatewayError("Failed to list invoices");
    }
  });

  app.get("/invoices/:id/pdf", async (c) => {
    const provider = billingRouteDeps.resolvePaymentProvider(c.env);
    const invoiceId = c.req.param("id");
    const { customerId } = await requirePaymentCustomerId(c);

    let invoice: NormalizedInvoice;
    try {
      invoice = await provider.retrieveInvoice(invoiceId);
    } catch (err) {
      logError("retrieveInvoice failed", err, { module: "billing" });
      throw new NotFoundError("Invoice");
    }

    if (invoice.customerId !== customerId) {
      throw new NotFoundError("Invoice");
    }

    const pdfUrl = invoice.pdfUrl;
    if (!pdfUrl) {
      throw new NotFoundError("Invoice PDF");
    }

    let pdfUrlParsed: URL;
    try {
      pdfUrlParsed = new URL(pdfUrl);
    } catch {
      logError("invoice pdf URL is malformed", pdfUrl, { module: "billing" });
      throw new NotFoundError("Invoice PDF");
    }
    if (!provider.isTrustedPdfUrl(pdfUrlParsed)) {
      logError(
        "invoice pdf URL is not from a trusted host",
        pdfUrlParsed.hostname,
        { module: "billing" },
      );
      throw new NotFoundError("Invoice PDF");
    }

    let pdfRes: Response;
    try {
      pdfRes = await fetch(pdfUrl);
    } catch (err) {
      logError("failed to fetch invoice pdf URL", err, { module: "billing" });
      throw new BadGatewayError("Failed to fetch invoice PDF");
    }

    if (!pdfRes.ok || !pdfRes.body) {
      const text = await pdfRes.text().catch((e) => {
        logWarn("Failed to read invoice PDF response body", {
          module: "billing",
          error: String(e),
        });
        return "";
      });
      logError("invoice pdf fetch failed", { status: pdfRes.status, text }, {
        module: "billing",
      });
      throw new BadGatewayError("Failed to fetch invoice PDF");
    }

    const headers = new Headers();
    headers.set("Content-Type", "application/pdf");
    headers.set(
      "Content-Disposition",
      `attachment; filename="invoice-${invoiceId}.pdf"`,
    );
    headers.set("Cache-Control", "no-store");
    const contentLength = pdfRes.headers.get("content-length");
    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }

    return new Response(pdfRes.body, { status: 200, headers });
  });

  app.post("/invoices/:id/send", async (c) => {
    const provider = billingRouteDeps.resolvePaymentProvider(c.env);
    const invoiceId = c.req.param("id");
    const { customerId } = await requirePaymentCustomerId(c);

    let invoice: NormalizedInvoice;
    try {
      invoice = await provider.retrieveInvoice(invoiceId);
    } catch (err) {
      logError("retrieveInvoice failed", err, { module: "billing" });
      throw new NotFoundError("Invoice");
    }

    if (invoice.customerId !== customerId) {
      throw new NotFoundError("Invoice");
    }

    try {
      await provider.sendInvoice(invoiceId);
    } catch (err) {
      logError("sendInvoice failed", err, { module: "billing" });
      throw new BadGatewayError("Failed to send invoice email");
    }

    return c.json({ success: true });
  });
}
