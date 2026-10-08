import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useSearchParams,
  useNavigate,
  useRevalidator,
  Link,
  useFetcher,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  InlineGrid,
  Box,
  DataTable,
  Button,
  ButtonGroup,
  EmptyState,
  Banner,
  Badge,
  Spinner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useEffect } from "react";

import { authenticate } from "../shopify.server";
import { checkSubscription } from "../services/billing.server";
import { allowedRange, FREE_TIER } from "../lib/plans";
import { ensureInitialSync } from "../services/auto-sync.server";
import db from "../db.server";
import {
  getDashboardMetrics,
  getTopProducts,
  getSnapshotData,
  getShopSettings,
  getAlertProducts,
} from "../services/margin-calculator.server";
import { getExpenseSummary } from "../services/expense-calculator.server";
import { getDiscountAnalysis } from "../services/discount-analytics.server";
import { generateInsights } from "../services/insights-engine.server";
import {
  getOrGenerateAiAnalysis,
  isAiEnabled,
} from "../services/ai-analysis.server";

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const isPaid = await checkSubscription(admin);
  const url = new URL(request.url);
  const requestedRange = url.searchParams.get("range") || "30d";
  // Free plan silently falls back instead of erroring, so a bookmarked 90d
  // link after a downgrade still renders.
  const range = allowedRange(requestedRange, isPaid);
  const rangeClamped = range !== requestedRange;

  // First visit: kick off the initial product + order sync in the background
  // and show progress, instead of an empty dashboard and a Setup scavenger hunt.
  const syncState = await ensureInitialSync(admin, shop);
  if (syncState !== "ready") {
    return json({
      hasData: false as const,
      syncState,
      productCount: 0,
      range,
      shop,
      isPaid,
      rangeClamped,
    });
  }

  const productCount = await db.productCost.count({ where: { shop } });

  const endDate = new Date();
  const startDate = new Date();
  if (range === "7d") startDate.setDate(endDate.getDate() - 7);
  else if (range === "90d") startDate.setDate(endDate.getDate() - 90);
  else startDate.setDate(endDate.getDate() - 30);

  const settings = await getShopSettings(shop);
  const feeConfig = settings
    ? {
        rate: Number(settings.paymentFeeRate),
        flat: Number(settings.paymentFeeFlat),
      }
    : undefined;

  const [metrics, topProducts, chartData, discountAnalysis, variantsWithCost] =
    await Promise.all([
      getDashboardMetrics(shop, startDate, endDate, feeConfig),
      getTopProducts(shop, startDate, endDate, 10),
      getSnapshotData(shop, startDate, endDate),
      getDiscountAnalysis(shop, startDate, endDate),
      db.productCost.count({ where: { shop, cost: { not: null } } }),
    ]);

  // Profit alerts
  const alertThreshold = settings?.marginAlertThreshold
    ? Number(settings.marginAlertThreshold)
    : null;
  const alertProducts =
    alertThreshold !== null
      ? await getAlertProducts(shop, alertThreshold)
      : [];

  // Expense allocation (optional)
  const periodDays = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  const expenseData = isPaid
    ? await getExpenseSummary(
        shop,
        metrics.grossProfit,
        metrics.totalRevenue,
        periodDays,
      )
    : null;

  // Generate insights
  const insights = generateInsights({
    metrics,
    topProducts,
    chartData,
    discountAnalysis,
    expenseData,
    totalVariants: productCount,
    variantsWithCost,
    range,
  });

  // Load cached AI analysis
  const aiCache = await db.aiAnalysisCache.findUnique({ where: { shop } });
  const aiCacheAge = aiCache
    ? Date.now() - aiCache.updatedAt.getTime()
    : null;
  const twentyFourHours = 24 * 60 * 60 * 1000;

  return json({
    hasData: true as const,
    productCount,
    metrics,
    topProducts,
    chartData,
    range,
    shop,
    isPaid,
    rangeClamped,
    hasFeeConfig: !!settings,
    alertThreshold,
    alertProductCount: alertProducts.length,
    expenseData: expenseData || null,
    insights,
    aiEnabled: isAiEnabled(),
    aiAnalysis: aiCache?.analysis || null,
    aiCachedAt: aiCache?.updatedAt.toISOString() || null,
    aiCanRefresh: aiCacheAge === null || aiCacheAge >= twentyFourHours,
    aiCompletedItems: aiCache?.completedItems
      ? JSON.parse(aiCache.completedItems)
      : [],
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "aiAnalysis") {
    // Pro only: each generation is a real Anthropic call, cache or not.
    if (!(await checkSubscription(admin))) {
      return json(
        {
          analysis: "",
          cached: false,
          error: "AI recommendations require the Pro plan.",
        },
        { status: 403 },
      );
    }
    const range = (formData.get("range") as string) || "30d";
    const result = await getOrGenerateAiAnalysis(shop, range);
    return json(result);
  }

  if (intent === "toggleAiItem") {
    const index = parseInt(formData.get("index") as string);
    const cache = await db.aiAnalysisCache.findUnique({ where: { shop } });
    if (cache) {
      const completed: number[] = JSON.parse(cache.completedItems || "[]");
      const updated = completed.includes(index)
        ? completed.filter((i) => i !== index)
        : [...completed, index];
      await db.aiAnalysisCache.update({
        where: { shop },
        data: { completedItems: JSON.stringify(updated) },
      });
      return json({ completedItems: updated });
    }
    return json({ completedItems: [] });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

function MetricCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {title}
        </Text>
        <Text as="p" variant="headingLg">
          {value}
        </Text>
        {subtitle && (
          <Text as="p" variant="bodySm" tone="subdued">
            {subtitle}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}

function ChartWrapper({
  data,
}: {
  data: Array<{
    name: string;
    data: Array<{ key: string; value: number }>;
  }>;
}) {
  const [Chart, setChart] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      import("@shopify/polaris-viz"),
      import("@shopify/polaris-viz/build/esm/styles.css"),
    ])
      .then(([mod]) => {
        setChart({
          LineChart: mod.LineChart,
          Provider: mod.PolarisVizProvider,
        });
      })
      .catch(() => setChart(null));
  }, []);

  if (!Chart) {
    return (
      <Box padding="400">
        <Text as="p" tone="subdued">
          Loading chart...
        </Text>
      </Box>
    );
  }

  const dollarFormatter = (val: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(val);

  return (
    <Chart.Provider
      themes={{ Light: { chartContainer: { padding: "0px" } } }}
    >
      <div style={{ height: 300 }}>
        <Chart.LineChart
          data={data}
          theme="Light"
          yAxisOptions={{ labelFormatter: dollarFormatter }}
          tooltipOptions={{
            valueFormatter: (val: number) =>
              new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }).format(val),
          }}
        />
      </div>
    </Chart.Provider>
  );
}

const INSIGHT_BADGE_TONE: Record<string, "warning" | "success" | "info"> = {
  warning: "warning",
  opportunity: "success",
  success: "success",
  info: "info",
};

function formatTimeAgo(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime();
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours < 1) return "just now";
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

// Re-runs the loader every few seconds while the initial sync is in flight,
// so the dashboard swaps in by itself instead of asking the merchant to refresh.
function SyncPoller() {
  const revalidator = useRevalidator();
  useEffect(() => {
    const id = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 3000);
    return () => clearInterval(id);
  }, [revalidator]);
  return null;
}

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  const aiFetcher = useFetcher<{
    analysis?: string;
    cached?: boolean;
    error?: string;
  }>();

  useEffect(() => setMounted(true), []);

  const handleRangeChange = (range: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("range", range);
    setSearchParams(params);
  };

  if (!data.hasData) {
    const syncing = data.syncState === "syncing";
    return (
      <Page>
        <TitleBar title="Profit Analytics" />
        {syncing && <SyncPoller />}
        <Layout>
          <Layout.Section>
            {syncing ? (
              <Banner title="Setting up your profit data" tone="info">
                <p>
                  Pulling your products, costs and the last 90 days of orders
                  from Shopify. This usually takes well under a minute, and the
                  dashboard will appear on its own when it's done.
                </p>
              </Banner>
            ) : (
              <Card>
                <EmptyState
                  heading="No products found yet"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  action={{ content: "Run sync manually", url: "/app/setup" }}
                >
                  <p>
                    We looked for products in your store and didn't find any.
                    Add products in Shopify, or run the sync again from Setup
                    once they're in.
                  </p>
                </EmptyState>
              </Card>
            )}
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const {
    metrics,
    topProducts,
    chartData,
    range,
    isPaid,
    rangeClamped,
    hasFeeConfig,
    alertThreshold,
    alertProductCount,
    expenseData,
    insights,
    aiEnabled,
    aiAnalysis,
    aiCachedAt,
    aiCanRefresh,
    aiCompletedItems,
  } = data;

  const toggleFetcher = useFetcher();

  // Use fetcher result if available, fall back to loader data
  const currentAiAnalysis = aiFetcher.data?.analysis || aiAnalysis;
  const aiError = aiFetcher.data?.error;
  const isLoadingAi = aiFetcher.state !== "idle";

  // Track completed items — merge toggle responses with loader data
  const [completedItems, setCompletedItems] = useState<number[]>(
    aiCompletedItems || [],
  );

  // Reset completed items when new analysis is generated
  useEffect(() => {
    if (aiFetcher.data?.analysis) {
      setCompletedItems([]);
    }
  }, [aiFetcher.data?.analysis]);

  // Sync from loader on navigation
  useEffect(() => {
    setCompletedItems(aiCompletedItems || []);
  }, [aiCompletedItems]);

  const toggleItem = (index: number) => {
    const updated = completedItems.includes(index)
      ? completedItems.filter((i) => i !== index)
      : [...completedItems, index];
    setCompletedItems(updated);
    toggleFetcher.submit(
      { intent: "toggleAiItem", index: index.toString() },
      { method: "POST" },
    );
  };

  // Parse AI analysis into intro text + numbered recommendation blocks
  const aiParsed = (() => {
    if (!currentAiAnalysis) return { intro: [] as string[], items: [] as string[] };
    const blocks = currentAiAnalysis
      .replace(/^#{1,3}\s+.*$/gm, "")
      .replace(/^---+$/gm, "")
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const intro: string[] = [];
    const items: string[] = [];
    for (const block of blocks) {
      if (/^\d+[\.\)]/.test(block)) {
        items.push(block.replace(/^\d+[\.\)]\s*/, ""));
      } else if (items.length === 0) {
        intro.push(block);
      } else {
        // Trailing text after numbered items — treat as intro-style
        intro.push(block);
      }
    }
    return { intro, items };
  })();

  const formatChartDate = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${m}/${d}/${y.slice(2)}`;
  };

  const chartSeries = [
    {
      name: "Revenue",
      data: (chartData || []).map((d) => ({
        key: formatChartDate(d.date),
        value: Math.round(d.revenue * 100) / 100,
      })),
    },
    {
      name: "Gross Profit",
      data: (chartData || []).map((d) => ({
        key: formatChartDate(d.date),
        value: Math.round(d.grossProfit * 100) / 100,
      })),
    },
  ];

  const topProductRows = topProducts.map((p) => [
    p.productTitle,
    p.unitsSold,
    formatMoney(p.revenue),
    formatMoney(p.cogs),
    formatMoney(p.grossProfit),
    `${p.marginPct.toFixed(1)}%`,
  ]);

  return (
    <Page>
      <TitleBar title="Profit Analytics" />
      <BlockStack gap="400">
        {rangeClamped && (
          <Banner
            title={`The Free plan covers the last ${FREE_TIER.maxRangeDays} days`}
            tone="info"
            action={{ content: "See plans", url: "/app/billing" }}
          >
            <p>Upgrade to report over any date range.</p>
          </Banner>
        )}
        {/* Profit alert banner */}
        {alertThreshold !== null && alertProductCount > 0 && (
          <Banner title="Low margin alert" tone="warning">
            <p>
              {alertProductCount} product
              {alertProductCount !== 1 ? "s" : ""}{" "}
              {alertProductCount !== 1 ? "have" : "has"} margins below{" "}
              {alertThreshold}%.{" "}
              <Link to="/app/products?margin=low">View products</Link>
            </p>
          </Banner>
        )}

        <InlineStack align="end">
          <ButtonGroup variant="segmented">
            <Button
              pressed={range === "7d"}
              onClick={() => handleRangeChange("7d")}
            >
              7 days
            </Button>
            <Button
              pressed={range === "30d"}
              onClick={() => handleRangeChange("30d")}
            >
              30 days
            </Button>
            <Button
              pressed={range === "90d"}
              onClick={() =>
                isPaid ? handleRangeChange("90d") : navigate("/app/billing")
              }
            >
              {isPaid ? "90 days" : "90 days (Pro)"}
            </Button>
          </ButtonGroup>
        </InlineStack>

        {/* Core metrics row */}
        <InlineGrid columns={{ xs: 1, sm: 2, lg: 4 }} gap="400">
          <MetricCard
            title="Total Revenue"
            value={formatMoney(metrics.totalRevenue)}
            subtitle={
              metrics.discountedOrderCount > 0
                ? `${metrics.orderCount} orders · ${Math.round((metrics.discountedOrderCount / metrics.orderCount) * 100)}% used discounts`
                : `${metrics.orderCount} orders`
            }
          />
          <MetricCard
            title="Total COGS"
            value={formatMoney(metrics.totalCogs)}
          />
          <MetricCard
            title="Gross Profit"
            value={formatMoney(metrics.grossProfit)}
            subtitle={`${metrics.avgMarginPct.toFixed(1)}% margin`}
          />
          <MetricCard
            title="Net Profit"
            value={formatMoney(metrics.netProfit)}
            subtitle={
              metrics.totalTransactionFees > 0
                ? `${metrics.netMarginPct.toFixed(1)}% after ${formatMoney(metrics.totalTransactionFees)} in fees`
                : hasFeeConfig
                  ? `${metrics.netMarginPct.toFixed(1)}% margin`
                  : "Configure fees in Setup"
            }
          />
        </InlineGrid>

        {/* Adjusted margin after expenses (only if expenses exist) */}
        {expenseData !== null && expenseData !== undefined && (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Adjusted Margin (After Expenses)
              </Text>
              <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
                <BlockStack gap="050">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Monthly Overhead
                  </Text>
                  <Text as="p" variant="headingMd">
                    {formatMoney(expenseData.totalMonthlyExpenses)}
                  </Text>
                </BlockStack>
                <BlockStack gap="050">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Adjusted Profit
                  </Text>
                  <Text as="p" variant="headingMd">
                    {formatMoney(expenseData.adjustedProfit)}
                  </Text>
                </BlockStack>
                <BlockStack gap="050">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Adjusted Margin
                  </Text>
                  <Text as="p" variant="headingMd">
                    {expenseData.adjustedMarginPct.toFixed(1)}%
                  </Text>
                </BlockStack>
              </InlineGrid>
            </BlockStack>
          </Card>
        )}

        {/* Insights card */}
        {insights.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Insights
                </Text>
                <Badge tone="info">{insights.length}</Badge>
              </InlineStack>
              {insights.map((insight) => (
                <InlineStack
                  key={insight.id}
                  gap="300"
                  blockAlign="start"
                  wrap={false}
                >
                  <div style={{ flexShrink: 0 }}>
                    <Badge
                      tone={INSIGHT_BADGE_TONE[insight.type] || "info"}
                    >
                      {insight.type === "warning"
                        ? "!"
                        : insight.type === "opportunity"
                          ? "+"
                          : insight.type === "success"
                            ? "\u2713"
                            : "i"}
                    </Badge>
                  </div>
                  <BlockStack gap="050">
                    <Text as="p" variant="headingSm">
                      {insight.title}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {insight.description}
                    </Text>
                  </BlockStack>
                </InlineStack>
              ))}
            </BlockStack>
          </Card>
        )}

        {mounted && chartData && chartData.length > 1 && (
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Revenue & Profit Trend
                  </Text>
                  <ChartWrapper data={chartSeries} />
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        )}

        {/* AI Analysis card */}
        {aiEnabled && (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="050">
                  <Text as="h2" variant="headingMd">
                    AI Analysis
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Powered by Claude
                  </Text>
                </BlockStack>
                <aiFetcher.Form method="POST">
                  <input type="hidden" name="intent" value="aiAnalysis" />
                  <input type="hidden" name="range" value={range} />
                  <Button
                    loading={isLoadingAi}
                    submit
                    disabled={!aiCanRefresh && !aiError && !!currentAiAnalysis}
                  >
                    {currentAiAnalysis
                      ? "Refresh Analysis"
                      : "Get AI Insights"}
                  </Button>
                </aiFetcher.Form>
              </InlineStack>

              {isLoadingAi && !currentAiAnalysis && (
                <InlineStack align="center" gap="200">
                  <Spinner size="small" />
                  <Text as="p" tone="subdued">
                    Analyzing your store data...
                  </Text>
                </InlineStack>
              )}

              {aiError && (
                <Banner tone="critical" title="Analysis unavailable">
                  <p>{aiError}</p>
                </Banner>
              )}

              {(aiParsed.intro.length > 0 || aiParsed.items.length > 0) && (
                <BlockStack gap="300">
                  {aiParsed.intro.map((text, i) => {
                    const formatted = text
                      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
                      .replace(/\*(.+?)\*/g, "<em>$1</em>");
                    return (
                      <div
                        key={`intro-${i}`}
                        style={{ lineHeight: 1.6, color: "var(--p-color-text-subdued)" }}
                        dangerouslySetInnerHTML={{ __html: formatted }}
                      />
                    );
                  })}
                  {aiParsed.items.map((rec, index) => {
                    const isDone = completedItems.includes(index);
                    const formatted = rec
                      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
                      .replace(/\*(.+?)\*/g, "<em>$1</em>");
                    return (
                      <div
                        key={index}
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleItem(index)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleItem(index);
                          }
                        }}
                        style={{
                          display: "flex",
                          gap: 12,
                          alignItems: "flex-start",
                          cursor: "pointer",
                          padding: "8px 0",
                          borderBottom: "1px solid var(--p-color-border-subdued)",
                        }}
                      >
                        <div
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 4,
                            border: isDone
                              ? "2px solid #2e7d32"
                              : "2px solid #8c9196",
                            backgroundColor: isDone ? "#2e7d32" : "transparent",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            marginTop: 2,
                            color: "#fff",
                            fontSize: 12,
                            fontWeight: "bold",
                          }}
                        >
                          {isDone && "\u2713"}
                        </div>
                        <div
                          style={{
                            lineHeight: 1.6,
                            opacity: isDone ? 0.5 : 1,
                            textDecoration: isDone ? "line-through" : "none",
                          }}
                          dangerouslySetInnerHTML={{ __html: formatted }}
                        />
                      </div>
                    );
                  })}
                  {aiCachedAt && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      Generated {formatTimeAgo(aiCachedAt)}
                      {!aiCanRefresh &&
                        " — refreshes available every 24 hours"}
                    </Text>
                  )}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        )}

        {topProducts.length > 0 && (
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Top Products by Profit
                  </Text>
                  <DataTable
                    columnContentTypes={[
                      "text",
                      "numeric",
                      "numeric",
                      "numeric",
                      "numeric",
                      "numeric",
                    ]}
                    headings={[
                      "Product",
                      "Units Sold",
                      "Revenue",
                      "COGS",
                      "Profit",
                      "Margin",
                    ]}
                    rows={topProductRows}
                  />
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        )}
      </BlockStack>
    </Page>
  );
}
