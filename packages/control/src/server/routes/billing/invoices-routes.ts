import type { Hono } from "hono";
import { BadGatewayError, NotFoundError } from "takos-common/errors";
import type { Env } from "../../../shared/types/index.ts";
import type { BaseVariables } from "../route-auth.ts";
import { logError, logWarn } from "../../../shared/utils/logger.ts";
import { toStripeCustomerId } from "./stripe.ts";
import { billingRouteDeps } from "./deps.ts";
import {
  parseInvoiceListQuery,
  requireStripeCustomerId,
  requireStripeSecretKey,
} from "./helpers.ts";

type BillingRouter = Hono<{ Bindings: Env; Variables: BaseVariables }>;

function toInvoiceSummary(invoice: {
  id: string;
  number?: string | null;
  status?: string | null;
  currency?: string | null;
  amount_due?: number | null;
  amount_paid?: number | null;
  total?: number | null;
  created?: number | null;
  period_start?: number | null;
  period_end?: number | null;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
}) {
  return {
    id: invoice.id,
    number: invoice.number ?? null,
    status: invoice.status ?? null,
    currency: invoice.currency ?? null,
    amount_due: invoice.amount_due ?? null,
    amount_paid: invoice.amount_paid ?? null,
    total: invoice.total ?? null,
    created: invoice.created ?? null,
    period_start: invoice.period_start ?? null,
    period_end: invoice.period_end ?? null,
    hosted_invoice_url: invoice.hosted_invoice_url ?? null,
    invoice_pdf: invoice.invoice_pdf ?? null,
  };
}

export function registerBillingInvoiceRoutes(app: BillingRouter) {
  app.get("/invoices", async (c) => {
    const secretKey = requireStripeSecretKey(c);
    const { customerId } = await requireStripeCustomerId(c);
    const { limit, startingAfter, endingBefore } = parseInvoiceListQuery(
      new URL(c.req.url),
    );

    try {
      const result = await billingRouteDeps.listInvoices({
        secretKey,
        customerId,
        limit,
        startingAfter,
        endingBefore,
      });

      return c.json({
        invoices: result.invoices.map(toInvoiceSummary),
        has_more: result.has_more,
      });
    } catch (err) {
      logError("listInvoices failed", err, { module: "billing" });
      throw new BadGatewayError("Failed to list invoices");
    }
  });

  app.get("/invoices/:id/pdf", async (c) => {
    const secretKey = requireStripeSecretKey(c);
    const invoiceId = c.req.param("id");
    const { customerId } = await requireStripeCustomerId(c);

    let invoice;
    try {
      invoice = await billingRouteDeps.retrieveInvoice({
        secretKey,
        invoiceId,
      });
    } catch (err) {
      logError("retrieveInvoice failed", err, { module: "billing" });
      throw new NotFoundError("Invoice");
    }

    if (toStripeCustomerId(invoice.customer) !== customerId) {
      throw new NotFoundError("Invoice");
    }

    const pdfUrl =
      typeof invoice.invoice_pdf === "string" && invoice.invoice_pdf
        ? invoice.invoice_pdf
        : null;
    if (!pdfUrl) {
      throw new NotFoundError("Invoice PDF");
    }

    let pdfUrlParsed: URL;
    try {
      pdfUrlParsed = new URL(pdfUrl);
    } catch {
      logError("invoice_pdf URL is malformed", pdfUrl, { module: "billing" });
      throw new NotFoundError("Invoice PDF");
    }
    if (!pdfUrlParsed.hostname.endsWith(".stripe.com")) {
      logError(
        "invoice_pdf URL is not from stripe.com",
        pdfUrlParsed.hostname,
        { module: "billing" },
      );
      throw new NotFoundError("Invoice PDF");
    }

    let pdfRes: Response;
    try {
      pdfRes = await fetch(pdfUrl);
    } catch (err) {
      logError("failed to fetch invoice_pdf URL", err, { module: "billing" });
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
      logError("invoice_pdf fetch failed", { status: pdfRes.status, text }, {
        module: "billing",
      });
      throw new BadGatewayError("Failed to fetch invoice PDF");
    }

    const headers = new Headers();
    headers.set("Content-Type", "application/pdf");
    headers.set(
      "Content-Disposition",
      `attachment; filename="stripe-invoice-${invoiceId}.pdf"`,
    );
    headers.set("Cache-Control", "no-store");
    const contentLength = pdfRes.headers.get("content-length");
    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }

    return new Response(pdfRes.body, { status: 200, headers });
  });

  app.post("/invoices/:id/send", async (c) => {
    const secretKey = requireStripeSecretKey(c);
    const invoiceId = c.req.param("id");
    const { customerId } = await requireStripeCustomerId(c);

    let invoice;
    try {
      invoice = await billingRouteDeps.retrieveInvoice({
        secretKey,
        invoiceId,
      });
    } catch (err) {
      logError("retrieveInvoice failed", err, { module: "billing" });
      throw new NotFoundError("Invoice");
    }

    if (toStripeCustomerId(invoice.customer) !== customerId) {
      throw new NotFoundError("Invoice");
    }

    try {
      await billingRouteDeps.sendInvoice({ secretKey, invoiceId });
    } catch (err) {
      logError("sendInvoice failed", err, { module: "billing" });
      throw new BadGatewayError("Failed to send invoice email");
    }

    return c.json({ success: true });
  });
}
