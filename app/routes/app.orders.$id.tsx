import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  InlineGrid,
  Banner,
  Box,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getShopSettings } from "../services/margin-calculator.server";

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function MarginBadge({
  margin,
  marginDollar,
}: {
  margin: number | null;
  marginDollar: number | null;
}) {
  if (margin === null) return <Badge tone="info">N/A</Badge>;
  const label = `${margin.toFixed(1)}% (${formatMoney(marginDollar || 0)})`;
  if (margin >= 40) return <Badge tone="success">{label}</Badge>;
  if (margin >= 20) return <Badge tone="warning">{label}</Badge>;
  return <Badge tone="critical">{label}</Badge>;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const orderId = `gid://shopify/Order/${params.id}`;
  const [lineItems, settings] = await Promise.all([
    db.orderLineItem.findMany({
      where: { shop, orderId },
      orderBy: { productTitle: "asc" },
    }),
    getShopSettings(shop),
  ]);

  if (lineItems.length === 0) {
    return json({
      found: false as const,
      orderName: null,
      orderDate: null,
      adminOrderId: null,
      lineItems: [],
      totals: null,
    });
  }

  let revenue = 0;
  let cogs = 0;
  let discountTotal = 0;
  let costedRevenue = 0;
  let missingCostCount = 0;
  const codes = new Set<string>();

  for (const li of lineItems) {
    revenue += Number(li.revenue);
    if (li.unitCost !== null) {
      cogs += Number(li.unitCost) * li.quantity;
      costedRevenue += Number(li.revenue);
    } else {
      missingCostCount += 1;
    }
    if (li.discountAmount !== null && Number(li.discountAmount) > 0) {
      discountTotal += Number(li.discountAmount);
      for (const code of (li.discountCodes || "").split(",")) {
        if (code.trim()) codes.add(code.trim());
      }
    }
  }

  const grossProfit = revenue - cogs;
  const marginPct = revenue > 0 ? (grossProfit / revenue) * 100 : null;

  // What the same items would have earned at full price. Discounts reduce
  // revenue while COGS stays fixed, so this isolates the discount's margin cost.
  const preDiscountRevenue = revenue + discountTotal;
  const preDiscountMarginPct =
    discountTotal > 0 && preDiscountRevenue > 0
      ? ((preDiscountRevenue - cogs) / preDiscountRevenue) * 100
      : null;

  // Same per-order estimate the dashboard uses: rate on revenue plus a flat fee
  const fees = settings
    ? (revenue * Number(settings.paymentFeeRate)) / 100 +
      Number(settings.paymentFeeFlat)
    : null;
  const netProfit = fees !== null ? grossProfit - fees : null;

  // Seeded/historical rows can carry non-numeric ids; only real Shopify
  // orders get an admin link
  const adminOrderId = /^\d+$/.test(params.id || "") ? params.id : null;

  return json({
    found: true as const,
    orderName: lineItems[0].orderName,
    orderDate: lineItems[0].orderDate.toISOString(),
    adminOrderId,
    lineItems: lineItems.map((li) => ({
      id: li.id,
      productTitle: li.productTitle,
      variantTitle: li.variantTitle,
      quantity: li.quantity,
      unitPrice: Number(li.unitPrice),
      unitCost: li.unitCost !== null ? Number(li.unitCost) : null,
      revenue: Number(li.revenue),
      grossProfit: li.grossProfit !== null ? Number(li.grossProfit) : null,
      marginPct: li.marginPct !== null ? Number(li.marginPct) : null,
      discountAmount:
        li.discountAmount !== null ? Number(li.discountAmount) : null,
    })),
    totals: {
      revenue,
      cogs,
      grossProfit,
      marginPct,
      discountTotal,
      discountCodes: Array.from(codes),
      preDiscountRevenue,
      preDiscountMarginPct,
      fees,
      netProfit,
      missingCostCount,
      costedRevenue,
    },
  });
};

function MetricCard({
  label,
  value,
  sub,
  subTone,
}: {
  label: string;
  value: string;
  sub?: string;
  subTone?: "success" | "subdued" | "critical";
}) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="headingLg">
          {value}
        </Text>
        {sub && (
          <Text
            as="p"
            variant="bodySm"
            tone={subTone === "success" ? "success" : subTone === "critical" ? "critical" : "subdued"}
          >
            {sub}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}

export default function OrderDetail() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!data.found) {
    return (
      <Page
        backAction={{
          content: "Orders",
          onAction: () => navigate("/app/orders"),
        }}
      >
        <TitleBar title="Order not found" />
        <Banner title="Order not found" tone="warning">
          <p>
            This order has no margin data. It may be outside the synced date
            range, or it belongs to a different store.
          </p>
        </Banner>
      </Page>
    );
  }

  const { orderName, orderDate, adminOrderId, lineItems, totals } = data;
  const t = totals!;

  return (
    <Page
      backAction={{
        content: "Orders",
        onAction: () => navigate("/app/orders"),
      }}
      secondaryActions={
        adminOrderId
          ? [
              {
                content: "View in Shopify",
                url: `shopify:admin/orders/${adminOrderId}`,
                target: "_top" as const,
              },
            ]
          : undefined
      }
    >
      <TitleBar title={`Order ${orderName}`} />
      <BlockStack gap="400">
        <InlineStack gap="200" blockAlign="center">
          <Text as="h2" variant="headingLg">
            {orderName}
          </Text>
          <Text as="span" tone="subdued">
            {new Date(orderDate!).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </Text>
        </InlineStack>

        <InlineGrid columns={{ xs: 2, md: 4 }} gap="300">
          <MetricCard
            label="Revenue"
            value={formatMoney(t.revenue)}
            sub={
              t.discountTotal > 0
                ? `after ${formatMoney(t.discountTotal)} in discounts`
                : undefined
            }
          />
          <MetricCard
            label="Cost of goods"
            value={formatMoney(t.cogs)}
            sub={
              t.missingCostCount > 0
                ? `${t.missingCostCount} item${t.missingCostCount === 1 ? "" : "s"} missing cost`
                : undefined
            }
            subTone={t.missingCostCount > 0 ? "critical" : undefined}
          />
          <MetricCard
            label="Gross profit"
            value={formatMoney(t.grossProfit)}
            sub={
              t.marginPct !== null
                ? `${t.marginPct.toFixed(1)}% margin`
                : undefined
            }
            subTone="success"
          />
          {t.fees !== null && t.netProfit !== null ? (
            <MetricCard
              label="Net profit"
              value={formatMoney(t.netProfit)}
              sub={`after ${formatMoney(t.fees)} est. payment fees`}
            />
          ) : (
            <MetricCard
              label="Net profit"
              value={formatMoney(t.grossProfit)}
              sub="no fee settings configured"
            />
          )}
        </InlineGrid>

        {t.discountTotal > 0 && (
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h3" variant="headingMd">
                  Discount impact
                </Text>
                {t.discountCodes.map((code) => (
                  <Badge key={code}>{code}</Badge>
                ))}
              </InlineStack>
              <InlineGrid columns={{ xs: 1, md: 3 }} gap="300">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Margin before discount
                  </Text>
                  <Text as="p" variant="headingMd">
                    {t.preDiscountMarginPct !== null
                      ? `${t.preDiscountMarginPct.toFixed(1)}%`
                      : "—"}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    on {formatMoney(t.preDiscountRevenue)} at full price
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Margin after discount
                  </Text>
                  <Text as="p" variant="headingMd">
                    {t.marginPct !== null ? `${t.marginPct.toFixed(1)}%` : "—"}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    on {formatMoney(t.revenue)} collected
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Profit given up
                  </Text>
                  <Text as="p" variant="headingMd" tone="critical">
                    {formatMoney(t.discountTotal)}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    discounts come straight out of profit
                  </Text>
                </BlockStack>
              </InlineGrid>
            </BlockStack>
          </Card>
        )}

        <Card padding="0">
          <Box padding="400" paddingBlockEnd="200">
            <Text as="h3" variant="headingMd">
              Line items
            </Text>
          </Box>
          <Divider />
          <IndexTable
            resourceName={{ singular: "line item", plural: "line items" }}
            itemCount={lineItems.length}
            headings={[
              { title: "Product" },
              { title: "Qty", alignment: "end" },
              { title: "Unit price", alignment: "end" },
              { title: "Unit cost", alignment: "end" },
              { title: "Revenue", alignment: "end" },
              { title: "Discount", alignment: "end" },
              { title: "Profit", alignment: "end" },
              { title: "Margin", alignment: "end" },
            ]}
            selectable={false}
          >
            {lineItems.map((li, index) => (
              <IndexTable.Row id={li.id} key={li.id} position={index}>
                <IndexTable.Cell>
                  <BlockStack gap="050">
                    <Text as="span">{li.productTitle}</Text>
                    {li.variantTitle && (
                      <Text as="span" tone="subdued" variant="bodySm">
                        {li.variantTitle}
                      </Text>
                    )}
                  </BlockStack>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" alignment="end">
                    {li.quantity}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" alignment="end">
                    {formatMoney(li.unitPrice)}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" alignment="end">
                    {li.unitCost !== null ? formatMoney(li.unitCost) : "—"}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" alignment="end">
                    {formatMoney(li.revenue)}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  {li.discountAmount && li.discountAmount > 0 ? (
                    <Text as="span" alignment="end" tone="critical">
                      -{formatMoney(li.discountAmount)}
                    </Text>
                  ) : (
                    <Text as="span" alignment="end" tone="subdued">
                      —
                    </Text>
                  )}
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" alignment="end">
                    {li.grossProfit !== null
                      ? formatMoney(li.grossProfit)
                      : "—"}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <InlineStack align="end">
                    <MarginBadge
                      margin={li.marginPct}
                      marginDollar={li.grossProfit}
                    />
                  </InlineStack>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>

        {t.missingCostCount > 0 && (
          <Banner tone="info">
            <p>
              {t.missingCostCount} line item
              {t.missingCostCount === 1 ? " is" : "s are"} missing cost data,
              so totals understate COGS. Add costs on the Products page for
              full accuracy.
            </p>
          </Banner>
        )}
      </BlockStack>
    </Page>
  );
}
