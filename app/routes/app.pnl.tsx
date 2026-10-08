import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  ButtonGroup,
  Banner,
  Box,
  Divider,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  getDashboardMetrics,
  getShopSettings,
} from "../services/margin-calculator.server";
import { getExpenseSummary } from "../services/expense-calculator.server";
import { checkSubscription } from "../services/billing.server";
import { FREE_TIER, allowedRange } from "../lib/plans";
import { ensureInitialSync } from "../services/auto-sync.server";

function money(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function pct(value: number) {
  return `${value.toFixed(1)}%`;
}

const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const isPaid = await checkSubscription(admin);

  const url = new URL(request.url);
  const requested = url.searchParams.get("range") || "30d";
  // Free plan silently falls back rather than erroring, so a bookmarked
  // 90d link after a downgrade still renders something useful.
  const range = allowedRange(requested, isPaid);
  const clamped = range !== requested;

  const syncState = await ensureInitialSync(admin, shop);
  if (syncState !== "ready") {
    return json({
      hasData: false as const,
      isPaid,
      range,
      clamped,
    });
  }

  const periodDays = RANGE_DAYS[range] ?? 30;
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - periodDays);

  const settings = await getShopSettings(shop);
  const feeConfig = settings
    ? {
        rate: Number(settings.paymentFeeRate),
        flat: Number(settings.paymentFeeFlat),
      }
    : undefined;

  const metrics = await getDashboardMetrics(
    shop,
    startDate,
    endDate,
    feeConfig,
  );

  // Operating expenses are a Pro feature, so the free P&L stops at net
  // profit after fees and shows the gap rather than hiding it.
  const expenseData = isPaid
    ? await getExpenseSummary(
        shop,
        metrics.grossProfit,
        metrics.totalRevenue,
        periodDays,
      )
    : null;

  const operatingExpenses = expenseData
    ? expenseData.totalMonthlyExpenses * (periodDays / 30)
    : 0;

  return json({
    hasData: true as const,
    isPaid,
    range,
    clamped,
    periodDays,
    metrics,
    operatingExpenses,
    bottomLine: metrics.netProfit - operatingExpenses,
  });
};

type Row = {
  label: string;
  value: number;
  /** Shown as a negative (deduction) line. */
  deduction?: boolean;
  /** Bold subtotal line with a rule above it. */
  subtotal?: boolean;
  note?: string;
};

function PnlRow({
  row,
  revenue,
}: {
  row: Row;
  revenue: number;
}) {
  const share = revenue > 0 ? (row.value / revenue) * 100 : 0;
  return (
    <Box
      paddingBlockStart={row.subtotal ? "300" : "150"}
      paddingBlockEnd={row.subtotal ? "300" : "150"}
    >
      <InlineStack align="space-between" blockAlign="center" wrap={false}>
        <BlockStack gap="050">
          <Text
            as="span"
            variant={row.subtotal ? "headingMd" : "bodyMd"}
            tone={row.deduction ? "subdued" : undefined}
          >
            {row.label}
          </Text>
          {row.note && (
            <Text as="span" variant="bodySm" tone="subdued">
              {row.note}
            </Text>
          )}
        </BlockStack>
        <InlineStack gap="400" blockAlign="center" wrap={false}>
          <Box minWidth="72px">
            <Text
              as="span"
              variant="bodySm"
              tone="subdued"
              alignment="end"
            >
              {revenue > 0 ? pct(share) : "—"}
            </Text>
          </Box>
          <Box minWidth="120px">
            <Text
              as="span"
              variant={row.subtotal ? "headingMd" : "bodyMd"}
              alignment="end"
              tone={
                row.subtotal && row.value < 0
                  ? "critical"
                  : row.deduction
                    ? "subdued"
                    : undefined
              }
            >
              {row.deduction ? `(${money(Math.abs(row.value))})` : money(row.value)}
            </Text>
          </Box>
        </InlineStack>
      </InlineStack>
    </Box>
  );
}

export default function PnlPage() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();

  const setRange = (range: string) => {
    setSearchParams((prev) => {
      prev.set("range", range);
      return prev;
    });
  };

  if (!data.hasData) {
    return (
      <Page>
        <TitleBar title="Profit & Loss" />
        <Layout>
          <Layout.Section>
            <Card>
              <EmptyState
                heading="No cost data yet"
                action={{
                  content: "Set up product costs",
                  onAction: () => navigate("/app/products"),
                }}
                image=""
              >
                <p>
                  Add costs to your products and your profit and loss statement
                  will build itself from your order history.
                </p>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const { metrics, isPaid, range, clamped, periodDays } = data;
  const revenue = metrics.totalRevenue;

  const rows: Row[] = [
    { label: "Revenue", value: revenue },
    {
      label: "Discounts",
      value: metrics.totalDiscounts,
      deduction: true,
      note:
        metrics.discountedOrderCount > 0
          ? `${metrics.discountedOrderCount} of ${metrics.orderCount} orders`
          : undefined,
    },
    { label: "Cost of goods sold", value: metrics.totalCogs, deduction: true },
    { label: "Gross profit", value: metrics.grossProfit, subtotal: true },
    {
      label: "Payment processing fees",
      value: metrics.totalTransactionFees,
      deduction: true,
      note: "Estimated from your configured rate",
    },
    { label: "Net profit after fees", value: metrics.netProfit, subtotal: true },
  ];

  if (isPaid) {
    rows.push({
      label: "Operating expenses",
      value: data.operatingExpenses,
      deduction: true,
      note: `Recurring expenses, pro-rated to ${periodDays} days`,
    });
    rows.push({
      label: "Bottom line",
      value: data.bottomLine,
      subtotal: true,
    });
  }

  return (
    <Page>
      <TitleBar title="Profit & Loss" />
      <Layout>
        {clamped && (
          <Layout.Section>
            <Banner
              title={`The Free plan covers the last ${FREE_TIER.maxRangeDays} days`}
              tone="info"
              action={{ content: "See plans", url: "/app/billing" }}
            >
              <p>
                Showing {periodDays} days instead. Upgrade to report over any
                date range.
              </p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="050">
                  <Text as="h2" variant="headingMd">
                    Profit &amp; Loss
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    Last {periodDays} days · {metrics.orderCount} orders
                  </Text>
                </BlockStack>
                <ButtonGroup variant="segmented">
                  <Button
                    pressed={range === "7d"}
                    onClick={() => setRange("7d")}
                  >
                    7 days
                  </Button>
                  <Button
                    pressed={range === "30d"}
                    onClick={() => setRange("30d")}
                  >
                    30 days
                  </Button>
                  <Button
                    pressed={range === "90d"}
                    onClick={() =>
                      isPaid ? setRange("90d") : navigate("/app/billing")
                    }
                    disabled={false}
                  >
                    {isPaid ? "90 days" : "90 days (Pro)"}
                  </Button>
                </ButtonGroup>
              </InlineStack>

              <Divider />

              <BlockStack gap="0">
                {rows.map((row, i) => (
                  <Box key={row.label}>
                    {row.subtotal && i > 0 && <Divider />}
                    <PnlRow row={row} revenue={revenue} />
                  </Box>
                ))}
              </BlockStack>

              <Divider />

              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  Net margin
                </Text>
                <Text as="span" variant="bodySm">
                  {pct(metrics.netMarginPct)}
                </Text>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {!isPaid && (
          <Layout.Section>
            <Banner
              title="Add operating expenses for your true bottom line"
              tone="info"
              action={{ content: "See plans", url: "/app/billing" }}
            >
              <p>
                This statement stops at net profit after payment fees. Pro adds
                recurring business expenses — software, packaging, shipping
                supplies — to show what you actually keep.
              </p>
            </Banner>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
