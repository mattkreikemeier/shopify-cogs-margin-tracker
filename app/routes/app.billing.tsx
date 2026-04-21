import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useEffect } from "react";
import { Page, Layout, Card, Banner, Text, BlockStack, Spinner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { requestSubscription } from "../services/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const returnUrl = `https://${session.shop}/admin/apps/cogs-margin-tracker`;

  try {
    const confirmationUrl = await requestSubscription(admin, returnUrl);
    return json({ confirmationUrl, error: null });
  } catch (e: any) {
    console.error("Billing error:", e.message);
    return json({ confirmationUrl: null, error: e.message });
  }
};

export default function BillingPage() {
  const { confirmationUrl, error } = useLoaderData<typeof loader>();

  useEffect(() => {
    if (confirmationUrl) {
      open(confirmationUrl, "_top");
    }
  }, [confirmationUrl]);

  if (error || !confirmationUrl) {
    return (
      <Page backAction={{ url: "/app" }} title="Subscribe">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Banner title="Subscription unavailable" tone="warning">
                  <p>{error || "Could not create subscription. Please try again."}</p>
                </Banner>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page title="Subscribe">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="200" inlineAlign="center">
              <Spinner size="small" />
              <Text as="p" variant="bodySm" tone="subdued">
                Redirecting to billing...
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
