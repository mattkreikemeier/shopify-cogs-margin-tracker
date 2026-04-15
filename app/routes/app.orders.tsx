import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  Pagination,
  ButtonGroup,
  Button,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useCallback } from "react";

import { authenticate } from "../shopify.server";
import db from "../db.server";

const PAGE_SIZE = 50;

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const range = url.searchParams.get("range") || "30d";
  const page = parseInt(url.searchParams.get("page") || "1");

  const endDate = new Date();
  const startDate = new Date();
  if (range === "7d") startDate.setDate(endDate.getDate() - 7);
  else if (range === "90d") startDate.setDate(endDate.getDate() - 90);
  else startDate.setDate(endDate.getDate() - 30);

  const where = {
    shop,
    orderDate: { gte: startDate, lte: endDate },
  };

  const [lineItems, total] = await Promise.all([
    db.orderLineItem.findMany({
      where,
      orderBy: { orderDate: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.orderLineItem.count({ where }),
  ]);

  return json({
    lineItems: lineItems.map((li) => ({
      id: li.id,
      orderName: li.orderName,
      orderDate: li.orderDate.toISOString(),
      productTitle: li.productTitle,
      variantTitle: li.variantTitle,
      quantity: li.quantity,
      unitCost: li.unitCost !== null ? Number(li.unitCost) : null,
      revenue: Number(li.revenue),
      grossProfit: li.grossProfit !== null ? Number(li.grossProfit) : null,
      marginPct: li.marginPct !== null ? Number(li.marginPct) : null,
      discountAmount: li.discountAmount !== null ? Number(li.discountAmount) : null,
      discountCodes: li.discountCodes,
    })),
    total,
    page,
    totalPages: Math.ceil(total / PAGE_SIZE),
    range,
  });
};

export default function Orders() {
  const { lineItems, total, page, totalPages, range } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const handleRangeChange = useCallback(
    (newRange: string) => {
      const params = new URLSearchParams(searchParams);
      params.set("range", newRange);
      params.set("page", "1");
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  const handlePagination = useCallback(
    (newPage: number) => {
      const params = new URLSearchParams(searchParams);
      params.set("page", newPage.toString());
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  return (
    <Page>
      <TitleBar title="Orders" />
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

        <Layout>
          <Layout.Section>
            <Card padding="400">
              {lineItems.length === 0 ? (
                <EmptyState
                  heading="No order data yet"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    Sync historical orders from the Setup page to see margin
                    data here.
                  </p>
                </EmptyState>
              ) : (
                <BlockStack gap="400">
                  <IndexTable
                    resourceName={{
                      singular: "line item",
                      plural: "line items",
                    }}
                    itemCount={total}
                    headings={[
                      { title: "Order" },
                      { title: "Date" },
                      { title: "Product" },
                      { title: "Qty", alignment: "end" },
                      { title: "Revenue", alignment: "end" },
                      { title: "Discount", alignment: "end" },
                      { title: "Cost", alignment: "end" },
                      { title: "Profit", alignment: "end" },
                      { title: "Margin", alignment: "end" },
                    ]}
                    selectable={false}
                  >
                    {lineItems.map((li, index) => (
                      <IndexTable.Row id={li.id} key={li.id} position={index}>
                        <IndexTable.Cell>
                          <Text
                            variant="bodyMd"
                            fontWeight="semibold"
                            as="span"
                          >
                            {li.orderName}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          {new Date(li.orderDate).toLocaleDateString()}
                        </IndexTable.Cell>
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
                            {formatMoney(li.revenue)}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          {li.discountAmount && li.discountAmount > 0 ? (
                            <BlockStack gap="050">
                              <Text as="span" alignment="end" tone="critical">
                                -{formatMoney(li.discountAmount)}
                              </Text>
                              {li.discountCodes && (
                                <Text as="span" alignment="end" variant="bodySm" tone="subdued">
                                  {li.discountCodes}
                                </Text>
                              )}
                            </BlockStack>
                          ) : (
                            <Text as="span" alignment="end" tone="subdued">
                              —
                            </Text>
                          )}
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" alignment="end">
                            {li.unitCost !== null
                              ? formatMoney(li.unitCost * li.quantity)
                              : "—"}
                          </Text>
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
                            <MarginBadge margin={li.marginPct} marginDollar={li.grossProfit} />
                          </InlineStack>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>

                  <InlineStack align="center">
                    <Pagination
                      hasPrevious={page > 1}
                      onPrevious={() => handlePagination(page - 1)}
                      hasNext={page < totalPages}
                      onNext={() => handlePagination(page + 1)}
                    />
                  </InlineStack>
                  <Text as="p" tone="subdued" alignment="center">
                    Showing {(page - 1) * PAGE_SIZE + 1}–
                    {Math.min(page * PAGE_SIZE, total)} of {total} items
                  </Text>
                </BlockStack>
              )}
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
