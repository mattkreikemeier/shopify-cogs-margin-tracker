import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  TextField,
  BlockStack,
  InlineStack,
  Button,
  ProgressBar,
  Banner,
  Select,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback, useEffect } from "react";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { syncAllProductCosts } from "../services/cost-sync.server";
import { syncHistoricalOrders } from "../services/order-sync.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [totalVariants, variantsWithCost, orderIds, lastSync, settings] =
    await Promise.all([
      db.productCost.count({ where: { shop } }),
      db.productCost.count({ where: { shop, cost: { not: null } } }),
      db.orderLineItem.findMany({
        where: { shop },
        distinct: ["orderId"],
        select: { orderId: true },
      }),
      db.productCost.findFirst({
        where: { shop },
        orderBy: { syncedAt: "desc" },
        select: { syncedAt: true },
      }),
      db.shopSettings.findUnique({ where: { shop } }),
    ]);

  return json({
    totalVariants,
    variantsWithCost,
    coveragePct:
      totalVariants > 0
        ? Math.round((variantsWithCost / totalVariants) * 100)
        : 0,
    orderCount: orderIds.length,
    lastProductSync: lastSync?.syncedAt
      ? lastSync.syncedAt.toISOString()
      : null,
    settings: settings
      ? {
          paymentFeeRate: Number(settings.paymentFeeRate),
          paymentFeeFlat: Number(settings.paymentFeeFlat),
          marginAlertThreshold: settings.marginAlertThreshold
            ? Number(settings.marginAlertThreshold)
            : null,
        }
      : null,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "syncProducts") {
      const result = await syncAllProductCosts(admin, shop);
      return json({ success: true, type: "products", ...result });
    }

    if (intent === "syncOrders") {
      const daysBack = parseInt((formData.get("daysBack") as string) || "60");
      const forceUpdate = formData.get("forceUpdate") === "true";
      const result = await syncHistoricalOrders(admin, shop, daysBack, forceUpdate);
      return json({ success: true, type: "orders", ...result });
    }

    if (intent === "savePaymentFees") {
      const rate = parseFloat(formData.get("feeRate") as string);
      const flat = parseFloat(formData.get("feeFlat") as string);
      if (isNaN(rate) || isNaN(flat) || rate < 0 || flat < 0) {
        return json({ error: "Invalid fee values" }, { status: 400 });
      }
      await db.shopSettings.upsert({
        where: { shop },
        create: { shop, paymentFeeRate: rate, paymentFeeFlat: flat },
        update: { paymentFeeRate: rate, paymentFeeFlat: flat },
      });
      return json({ success: true, type: "fees" });
    }

    if (intent === "saveAlertThreshold") {
      const thresholdStr = formData.get("threshold") as string;
      const threshold = thresholdStr ? parseFloat(thresholdStr) : null;
      if (threshold !== null && (isNaN(threshold) || threshold < 0 || threshold > 100)) {
        return json({ error: "Threshold must be 0-100" }, { status: 400 });
      }
      await db.shopSettings.upsert({
        where: { shop },
        create: { shop, marginAlertThreshold: threshold },
        update: { marginAlertThreshold: threshold },
      });
      return json({ success: true, type: "alerts" });
    }

    return json({ error: "Unknown intent" }, { status: 400 });
  } catch (err) {
    console.error("Setup action error:", err);
    return json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
};

export default function Setup() {
  const {
    totalVariants,
    variantsWithCost,
    coveragePct,
    orderCount,
    lastProductSync,
    settings,
  } = useLoaderData<typeof loader>();

  const productFetcher = useFetcher();
  const orderFetcher = useFetcher();
  const feeFetcher = useFetcher();
  const alertFetcher = useFetcher();

  const [daysBack, setDaysBack] = useState("60");
  const [feeRate, setFeeRate] = useState(
    settings?.paymentFeeRate?.toString() || "2.9",
  );
  const [feeFlat, setFeeFlat] = useState(
    settings?.paymentFeeFlat?.toString() || "0.30",
  );
  const [alertThreshold, setAlertThreshold] = useState(
    settings?.marginAlertThreshold?.toString() || "",
  );

  const isSyncingProducts = productFetcher.state !== "idle";
  const isSyncingOrders = orderFetcher.state !== "idle";
  const isSavingFees = feeFetcher.state !== "idle";
  const isSavingAlert = alertFetcher.state !== "idle";

  return (
    <Page>
      <TitleBar title="Setup" />
      <BlockStack gap="400">
        {productFetcher.data?.success && (
          <Banner title="Product sync complete" tone="success">
            <p>
              Synced {productFetcher.data.totalVariants} variants (
              {productFetcher.data.variantsWithCost} with costs,{" "}
              {productFetcher.data.variantsWithoutCost} without).
            </p>
          </Banner>
        )}

        {orderFetcher.data?.success && (
          <Banner title="Order sync complete" tone="success">
            <p>
              Processed {orderFetcher.data.ordersProcessed} orders with{" "}
              {orderFetcher.data.lineItemsCreated} line items.
            </p>
          </Banner>
        )}

        {feeFetcher.data?.success && (
          <Banner title="Payment fees saved" tone="success" />
        )}

        {alertFetcher.data?.success && (
          <Banner title="Alert threshold saved" tone="success" />
        )}

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Product Cost Coverage
                </Text>

                {totalVariants === 0 ? (
                  <Text as="p" tone="subdued">
                    No products synced yet. Click "Sync Product Costs" below to
                    pull your product catalog and cost data from Shopify.
                  </Text>
                ) : (
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="p">
                        {variantsWithCost} of {totalVariants} variants have
                        costs
                      </Text>
                      <Text as="p" fontWeight="semibold">
                        {coveragePct}%
                      </Text>
                    </InlineStack>
                    <ProgressBar progress={coveragePct} size="small" />
                    {coveragePct < 100 && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Set missing costs in the Products tab or import via CSV.
                      </Text>
                    )}
                  </BlockStack>
                )}

                <Divider />

                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h3" variant="headingSm">
                      Sync Product Costs
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Pulls all products and their cost data from Shopify.
                      {lastProductSync && (
                        <>
                          {" "}
                          Last synced:{" "}
                          {new Date(lastProductSync).toLocaleString()}
                        </>
                      )}
                    </Text>
                  </BlockStack>
                  <productFetcher.Form method="POST">
                    <input type="hidden" name="intent" value="syncProducts" />
                    <Button loading={isSyncingProducts} submit>
                      {totalVariants === 0
                        ? "Sync Product Costs"
                        : "Re-sync Products"}
                    </Button>
                  </productFetcher.Form>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Historical Orders
                </Text>

                <Text as="p" tone="subdued">
                  {orderCount > 0
                    ? `${orderCount} orders synced. Sync again to pull recent orders.`
                    : "Import past orders to build your profit margin history. Costs are locked at the time of import based on current product costs."}
                </Text>

                <InlineStack align="space-between" blockAlign="end">
                  <div style={{ width: 160 }}>
                    <Select
                      label="Time range"
                      options={[
                        { label: "Last 30 days", value: "30" },
                        { label: "Last 60 days", value: "60" },
                        { label: "Last 90 days", value: "90" },
                        { label: "Last 180 days", value: "180" },
                      ]}
                      value={daysBack}
                      onChange={setDaysBack}
                    />
                  </div>
                  <InlineStack gap="200">
                    <orderFetcher.Form method="POST">
                      <input type="hidden" name="intent" value="syncOrders" />
                      <input type="hidden" name="daysBack" value={daysBack} />
                      <Button loading={isSyncingOrders} submit>
                        {orderCount > 0 ? "Re-sync Orders" : "Sync Orders"}
                      </Button>
                    </orderFetcher.Form>
                    {orderCount > 0 && (
                      <orderFetcher.Form method="POST">
                        <input type="hidden" name="intent" value="syncOrders" />
                        <input type="hidden" name="daysBack" value={daysBack} />
                        <input type="hidden" name="forceUpdate" value="true" />
                        <Button loading={isSyncingOrders} submit variant="plain">
                          Re-sync with discount data
                        </Button>
                      </orderFetcher.Form>
                    )}
                  </InlineStack>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Payment Processing Fees
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Configure your payment processor fees to see net profit after
                  transaction costs. Defaults are standard Shopify Payments
                  rates.
                </Text>

                <InlineStack gap="400" blockAlign="end">
                  <div style={{ width: 140 }}>
                    <TextField
                      label="Fee rate (%)"
                      type="number"
                      value={feeRate}
                      onChange={setFeeRate}
                      autoComplete="off"
                      suffix="%"
                      step={0.1}
                      min={0}
                    />
                  </div>
                  <div style={{ width: 140 }}>
                    <TextField
                      label="Flat fee per txn"
                      type="number"
                      value={feeFlat}
                      onChange={setFeeFlat}
                      autoComplete="off"
                      prefix="$"
                      step={0.01}
                      min={0}
                    />
                  </div>
                  <feeFetcher.Form method="POST">
                    <input type="hidden" name="intent" value="savePaymentFees" />
                    <input type="hidden" name="feeRate" value={feeRate} />
                    <input type="hidden" name="feeFlat" value={feeFlat} />
                    <Button loading={isSavingFees} submit>
                      Save
                    </Button>
                  </feeFetcher.Form>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Profit Alerts
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Get warned on the dashboard when any product's margin drops
                  below your threshold. Leave empty to disable alerts.
                </Text>

                <InlineStack gap="400" blockAlign="end">
                  <div style={{ width: 180 }}>
                    <TextField
                      label="Alert when margin below"
                      type="number"
                      value={alertThreshold}
                      onChange={setAlertThreshold}
                      autoComplete="off"
                      suffix="%"
                      placeholder="e.g. 20"
                      step={1}
                      min={0}
                      max={100}
                    />
                  </div>
                  <alertFetcher.Form method="POST">
                    <input
                      type="hidden"
                      name="intent"
                      value="saveAlertThreshold"
                    />
                    <input
                      type="hidden"
                      name="threshold"
                      value={alertThreshold}
                    />
                    <Button loading={isSavingAlert} submit>
                      Save
                    </Button>
                  </alertFetcher.Form>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Getting Started
                </Text>
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" fontWeight="semibold">
                      Step 1:
                    </Text>
                    <Text as="span">
                      Sync product costs to pull your catalog from Shopify
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" fontWeight="semibold">
                      Step 2:
                    </Text>
                    <Text as="span">
                      Fill in any missing costs via Products tab or CSV import
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" fontWeight="semibold">
                      Step 3:
                    </Text>
                    <Text as="span">
                      Sync historical orders to build your margin history
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" fontWeight="semibold">
                      Step 4:
                    </Text>
                    <Text as="span">
                      View your Dashboard for real-time margin insights
                    </Text>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
