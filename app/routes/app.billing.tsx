import { json } from "@remix-run/node";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useEffect, useState } from "react";
import {
  Page,
  Layout,
  Card,
  Banner,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  List,
  Modal,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import {
  getActiveSubscription,
  requestSubscription,
  cancelSubscription,
  billingReturnUrl,
} from "../services/billing.server";
import { PRO_PLAN, FREE_TIER } from "../lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const subscription = await getActiveSubscription(admin);
  return json({ subscription });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "subscribe") {
    const confirmationUrl = await requestSubscription(
      admin,
      billingReturnUrl(session.shop),
      session.shop,
    );
    if (!confirmationUrl) {
      return json({
        intent,
        error: "Could not create subscription. Please try again.",
        confirmationUrl: null,
        cancelled: false,
      });
    }
    return json({ intent, error: null, confirmationUrl, cancelled: false });
  }

  if (intent === "cancel") {
    const subscription = await getActiveSubscription(admin);
    if (subscription) {
      const ok = await cancelSubscription(admin, subscription.id);
      if (!ok) {
        return json({
          intent,
          error: "Could not cancel subscription. Please try again.",
          confirmationUrl: null,
          cancelled: false,
        });
      }
    }
    return json({ intent, error: null, confirmationUrl: null, cancelled: true });
  }

  return json({ intent, error: null, confirmationUrl: null, cancelled: false });
};

export default function BillingPage() {
  const { subscription } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [showCancelModal, setShowCancelModal] = useState(false);

  const busy = fetcher.state !== "idle";
  const data = fetcher.data;

  useEffect(() => {
    if (data?.confirmationUrl) {
      // Billing confirmation must load at the top level, outside the iframe
      open(data.confirmationUrl, "_top");
    }
  }, [data]);

  const isPaid = !!subscription && !data?.cancelled;

  return (
    <Page backAction={{ url: "/app" }} title="Plan">
      <Layout>
        {data?.error && (
          <Layout.Section>
            <Banner title="Something went wrong" tone="critical">
              <p>{data.error}</p>
            </Banner>
          </Layout.Section>
        )}
        {data?.cancelled && (
          <Layout.Section>
            <Banner title="You're now on the Free plan" tone="success">
              <p>
                Your Pro subscription has been cancelled. You can upgrade again
                at any time.
              </p>
            </Banner>
          </Layout.Section>
        )}
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Free
                </Text>
                {!isPaid && <Badge tone="success">Current plan</Badge>}
              </InlineStack>
              <Text as="p" variant="headingLg">
                $0/month
              </Text>
              <List>
                <List.Item>
                  Profit dashboard and P&amp;L, up to {FREE_TIER.maxRangeDays}{" "}
                  days
                </List.Item>
                <List.Item>Per-product margins with cost editing</List.Item>
                <List.Item>Per-order profit breakdown</List.Item>
              </List>
              {isPaid && (
                <Button
                  onClick={() => setShowCancelModal(true)}
                  loading={busy && fetcher.formData?.get("intent") === "cancel"}
                >
                  Downgrade to Free
                </Button>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Pro
                </Text>
                {isPaid && <Badge tone="success">Current plan</Badge>}
              </InlineStack>
              <Text as="p" variant="headingLg">
                ${PRO_PLAN.price}/month
              </Text>
              <List>
                <List.Item>Everything in Free, over any date range</List.Item>
                <List.Item>Operating expenses and adjusted margins</List.Item>
                <List.Item>Discount impact analysis</List.Item>
                <List.Item>AI profit recommendations</List.Item>
                <List.Item>Bulk CSV cost import and export</List.Item>
                <List.Item>{PRO_PLAN.trialDays}-day free trial</List.Item>
              </List>
              {!isPaid && (
                <Button
                  variant="primary"
                  onClick={() =>
                    fetcher.submit({ intent: "subscribe" }, { method: "POST" })
                  }
                  loading={
                    busy && fetcher.formData?.get("intent") === "subscribe"
                  }
                >
                  Upgrade to Pro
                </Button>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
      <Modal
        open={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        title="Downgrade to Free?"
        primaryAction={{
          content: "Downgrade",
          destructive: true,
          onAction: () => {
            setShowCancelModal(false);
            fetcher.submit({ intent: "cancel" }, { method: "POST" });
          },
        }}
        secondaryActions={[
          {
            content: "Keep Pro",
            onAction: () => setShowCancelModal(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            Your Pro subscription will be cancelled immediately. Your cost
            and order data stays exactly as it is, but reporting returns to a{" "}
            {FREE_TIER.maxRangeDays}-day window and expenses, discount
            analysis, AI recommendations and CSV import become unavailable.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
