import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  InlineGrid,
  IndexTable,
  Badge,
  Button,
  ButtonGroup,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { getDiscountAnalysis } from "../services/discount-analytics.server";

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const range = url.searchParams.get("range") || "30d";

  const endDate = new Date();
  const startDate = new Date();
  if (range === "7d") startDate.setDate(endDate.getDate() - 7);
  else if (range === "90d") startDate.setDate(endDate.getDate() - 90);
  else startDate.setDate(endDate.getDate() - 30);

  const analysis = await getDiscountAnalysis(shop, startDate, endDate);

  return json({ analysis, range });
};

export default function Discounts() {
  const { analysis, range } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const handleRangeChange = (newRange: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("range", newRange);
    setSearchParams(params);
  };

  const marginDiff =
    analysis.discountedAvgMargin - analysis.nonDiscountedAvgMargin;
  const hasDiscountData = analysis.discountedOrderCount > 0;

  return (
    <Page>
      <TitleBar title="Discount Analysis" />
      <BlockStack gap="400">
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
              onClick={() => handleRangeChange("90d")}
            >
              90 days
            </Button>
          </ButtonGroup>
        </InlineStack>

        {!hasDiscountData ? (
          <Layout>
            <Layout.Section>
              <Card>
                <EmptyState
                  heading="No discounted orders yet"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    When orders with discount codes come in, you'll see a
                    breakdown of how each code impacts your margins here.
                  </p>
                </EmptyState>
              </Card>
            </Layout.Section>
          </Layout>
        ) : (
          <>
            {/* Discounted vs Non-Discounted comparison */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Discounted vs Full-Price Orders
                </Text>
                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                  <Card>
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h3" variant="headingSm">
                          Discounted Orders
                        </Text>
                        <Badge tone="warning">
                          {analysis.discountedOrderCount} orders
                        </Badge>
                      </InlineStack>
                      <InlineGrid columns={3} gap="200">
                        <BlockStack gap="050">
                          <Text as="p" variant="bodySm" tone="subdued">
                            Avg Order Value
                          </Text>
                          <Text as="p" variant="headingSm">
                            {formatMoney(analysis.discountedAvgOrderValue)}
                          </Text>
                        </BlockStack>
                        <BlockStack gap="050">
                          <Text as="p" variant="bodySm" tone="subdued">
                            Avg Margin
                          </Text>
                          <Text as="p" variant="headingSm">
                            {analysis.discountedAvgMargin.toFixed(1)}%
                          </Text>
                        </BlockStack>
                        <BlockStack gap="050">
                          <Text as="p" variant="bodySm" tone="subdued">
                            Total Discounts
                          </Text>
                          <Text as="p" variant="headingSm">
                            {formatMoney(analysis.totalDiscountAmount)}
                          </Text>
                        </BlockStack>
                      </InlineGrid>
                    </BlockStack>
                  </Card>
                  <Card>
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h3" variant="headingSm">
                          Full-Price Orders
                        </Text>
                        <Badge>
                          {analysis.totalOrderCount -
                            analysis.discountedOrderCount}{" "}
                          orders
                        </Badge>
                      </InlineStack>
                      <InlineGrid columns={2} gap="200">
                        <BlockStack gap="050">
                          <Text as="p" variant="bodySm" tone="subdued">
                            Avg Order Value
                          </Text>
                          <Text as="p" variant="headingSm">
                            {formatMoney(analysis.nonDiscountedAvgOrderValue)}
                          </Text>
                        </BlockStack>
                        <BlockStack gap="050">
                          <Text as="p" variant="bodySm" tone="subdued">
                            Avg Margin
                          </Text>
                          <Text as="p" variant="headingSm">
                            {analysis.nonDiscountedAvgMargin.toFixed(1)}%
                          </Text>
                        </BlockStack>
                      </InlineGrid>
                    </BlockStack>
                  </Card>
                </InlineGrid>
                {analysis.nonDiscountedAvgMargin > 0 && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Margin impact: discounted orders have{" "}
                    <Text
                      as="span"
                      tone={marginDiff < 0 ? "critical" : "success"}
                      fontWeight="semibold"
                    >
                      {marginDiff > 0 ? "+" : ""}
                      {marginDiff.toFixed(1)} points
                    </Text>{" "}
                    {marginDiff < 0 ? "lower" : "higher"} margins than
                    full-price orders
                  </Text>
                )}
              </BlockStack>
            </Card>

            {/* Per-code breakdown */}
            {analysis.byCode.length > 0 && (
              <Layout>
                <Layout.Section>
                  <Card padding="400">
                    <BlockStack gap="300">
                      <Text as="h2" variant="headingMd">
                        Performance by Discount Code
                      </Text>
                      <IndexTable
                        resourceName={{
                          singular: "discount code",
                          plural: "discount codes",
                        }}
                        itemCount={analysis.byCode.length}
                        headings={[
                          { title: "Code" },
                          { title: "Orders", alignment: "end" },
                          { title: "Revenue", alignment: "end" },
                          { title: "Discounted", alignment: "end" },
                          { title: "Profit", alignment: "end" },
                          { title: "Avg Margin", alignment: "end" },
                        ]}
                        selectable={false}
                      >
                        {analysis.byCode.map((row, index) => (
                          <IndexTable.Row
                            id={row.code}
                            key={row.code}
                            position={index}
                          >
                            <IndexTable.Cell>
                              <Text
                                as="span"
                                fontWeight="bold"
                                variant="bodyMd"
                              >
                                {row.code}
                              </Text>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Text as="span" alignment="end">
                                {row.orderCount}
                              </Text>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Text as="span" alignment="end">
                                {formatMoney(row.totalRevenue)}
                              </Text>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Text as="span" alignment="end" tone="critical">
                                -{formatMoney(row.totalDiscount)}
                              </Text>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Text as="span" alignment="end">
                                {formatMoney(row.totalProfit)}
                              </Text>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <InlineStack align="end">
                                <Badge
                                  tone={
                                    row.avgMarginPct >= 40
                                      ? "success"
                                      : row.avgMarginPct >= 20
                                        ? "warning"
                                        : "critical"
                                  }
                                >
                                  {row.avgMarginPct.toFixed(1)}%
                                </Badge>
                              </InlineStack>
                            </IndexTable.Cell>
                          </IndexTable.Row>
                        ))}
                      </IndexTable>
                    </BlockStack>
                  </Card>
                </Layout.Section>
              </Layout>
            )}
          </>
        )}
      </BlockStack>
    </Page>
  );
}
