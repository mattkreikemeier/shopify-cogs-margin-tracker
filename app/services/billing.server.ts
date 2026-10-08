import { FREE_TIER, PRO_PLAN } from "../lib/plans";

export { FREE_TIER, PRO_PLAN };

export type ActiveSubscription = {
  id: string;
  name: string;
  status: string;
  trialDays: number;
  currentPeriodEnd: string | null;
};

export async function getActiveSubscription(
  admin: any,
): Promise<ActiveSubscription | null> {
  const response = await admin.graphql(`
    #graphql
    query CheckSubscription {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          trialDays
          currentPeriodEnd
        }
      }
    }
  `);
  const data = await response.json();
  const subscriptions =
    data.data?.currentAppInstallation?.activeSubscriptions || [];
  return (
    subscriptions.find(
      (s: any) => s.status === "ACTIVE" || s.status === "ACCEPTED",
    ) || null
  );
}

export async function checkSubscription(admin: any): Promise<boolean> {
  return (await getActiveSubscription(admin)) !== null;
}

// BILLING_TEST_SHOPS is a comma-separated list of shop domains that get test
// charges, because dev stores have no payment method on file and so cannot
// approve a real charge.
//
// There is deliberately NO global "make everything a test charge" switch. The
// old BILLING_TEST=1 env var was exactly that, and on 2026-10-07 it was found
// still set in production — every charge for roughly two months was a test
// charge, so the app could not collect money and nothing surfaced it.
//
// Scoping the override to named shops makes forgetting to remove it harmless:
// a stale entry only ever affects that one dev store, never a real merchant.
function isTestShop(shop: string): boolean {
  return (process.env.BILLING_TEST_SHOPS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(shop);
}

export async function requestSubscription(
  admin: any,
  returnUrl: string,
  shop: string,
): Promise<string | null> {
  const response = await admin.graphql(
    `#graphql
    mutation AppSubscriptionCreate(
      $name: String!
      $lineItems: [AppSubscriptionLineItemInput!]!
      $returnUrl: URL!
      $trialDays: Int
      $test: Boolean
    ) {
      appSubscriptionCreate(
        name: $name
        lineItems: $lineItems
        returnUrl: $returnUrl
        trialDays: $trialDays
        test: $test
      ) {
        appSubscription { id }
        confirmationUrl
        userErrors { field message }
      }
    }`,
    {
      variables: {
        name: PRO_PLAN.name,
        returnUrl,
        trialDays: PRO_PLAN.trialDays,
        test: isTestShop(shop) || process.env.NODE_ENV !== "production",
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: {
                  amount: PRO_PLAN.price,
                  currencyCode: PRO_PLAN.currencyCode,
                },
                interval: "EVERY_30_DAYS",
              },
            },
          },
        ],
      },
    },
  );
  const data = await response.json();
  const errors = data.data?.appSubscriptionCreate?.userErrors;
  if (errors?.length > 0) {
    console.error("Subscription creation failed:", errors);
    return null;
  }
  return data.data?.appSubscriptionCreate?.confirmationUrl || null;
}

export async function cancelSubscription(
  admin: any,
  subscriptionId: string,
): Promise<boolean> {
  const response = await admin.graphql(
    `#graphql
    mutation AppSubscriptionCancel($id: ID!) {
      appSubscriptionCancel(id: $id) {
        appSubscription { id status }
        userErrors { field message }
      }
    }`,
    { variables: { id: subscriptionId } },
  );
  const data = await response.json();
  const errors = data.data?.appSubscriptionCancel?.userErrors;
  if (errors?.length > 0) {
    console.error("Subscription cancel failed:", errors);
    return false;
  }
  return true;
}

/**
 * Embedded-app URL that always resolves, regardless of the app's
 * App Store handle (which Shopify may change to dedupe names).
 * Using a handle here is what caused the review-blocking 404.
 */
export function billingReturnUrl(shop: string): string {
  return `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}/app/billing`;
}

/**
 * Guard for Pro-only routes. Throws a redirect to the plan page rather than
 * rendering a locked shell, so a free merchant lands somewhere they can act
 * instead of a dead end. `feature` drives the copy on the plan page.
 */
export async function requirePro(admin: any, feature: string): Promise<void> {
  if (await checkSubscription(admin)) return;
  throw new Response(null, {
    status: 302,
    headers: { Location: `/app/billing?upgrade=${encodeURIComponent(feature)}` },
  });
}
