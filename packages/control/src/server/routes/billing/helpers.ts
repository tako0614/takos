import type { Context } from "hono";
import { BadRequestError } from "takos-common/errors";
import type { Env } from "../../../shared/types/index.ts";
import type { BaseVariables } from "../route-auth.ts";
import { billingRouteDeps } from "./deps.ts";

export type BillingRouteContext = Context<{
  Bindings: Env;
  Variables: BaseVariables;
}>;

export async function loadBillingAccount(c: BillingRouteContext) {
  const user = c.get("user");
  return await billingRouteDeps.getOrCreateBillingAccount(c.env.DB, user.id);
}

export async function requirePaymentCustomerId(c: BillingRouteContext) {
  const account = await loadBillingAccount(c);
  if (!account.providerCustomerId) {
    throw new BadRequestError("No payment account found");
  }
  return {
    account,
    customerId: account.providerCustomerId,
  };
}

export function getRequestOrigin(c: BillingRouteContext): string {
  return new URL(c.req.url).origin;
}

export function parseInvoiceListQuery(url: URL) {
  const limitParam = Number(url.searchParams.get("limit") ?? "20");
  return {
    limit: Math.min(
      Math.max(Number.isFinite(limitParam) ? limitParam : 20, 1),
      100,
    ),
    startingAfter: url.searchParams.get("starting_after") ?? undefined,
    endingBefore: url.searchParams.get("ending_before") ?? undefined,
  };
}
