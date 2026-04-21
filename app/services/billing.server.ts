export async function checkSubscription(admin: any): Promise<boolean> {
  const response = await admin.graphql(`
    #graphql
    query CheckSubscription {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
        }
      }
    }
  `);
  const data = await response.json();
  const subscriptions =
    data.data?.currentAppInstallation?.activeSubscriptions || [];
  return subscriptions.some(
    (s: any) => s.status === "ACTIVE" || s.status === "ACCEPTED",
  );
}

export async function requestSubscription(
  admin: any,
  returnUrl: string,
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
        name: "COGS Margin Tracker",
        returnUrl,
        trialDays: 7,
        test: process.env.NODE_ENV !== "production",
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: 9.99, currencyCode: "USD" },
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
