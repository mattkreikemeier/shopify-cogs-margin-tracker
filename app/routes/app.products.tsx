import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useSearchParams,
  useFetcher,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  TextField,
  Badge,
  InlineStack,
  BlockStack,
  Button,
  Pagination,
  Select,
  EmptyState,
  Banner,
  Spinner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback, useEffect } from "react";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { updateVariantCost } from "../services/cost-writer.server";
import { syncAllProductCosts } from "../services/cost-sync.server";
import { getShopSettings } from "../services/margin-calculator.server";

const PAGE_SIZE = 25;

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function MarginBadge({
  margin,
  marginDollar,
  alertThreshold,
}: {
  margin: number | null;
  marginDollar: number | null;
  alertThreshold?: number | null;
}) {
  if (margin === null) return <Badge tone="info">No cost</Badge>;
  const label = `${margin.toFixed(1)}% (${formatMoney(marginDollar || 0)})`;
  const warnLevel = alertThreshold ?? 20;
  const goodLevel = Math.max(warnLevel * 2, 40);
  if (margin >= goodLevel) return <Badge tone="success">{label}</Badge>;
  if (margin >= warnLevel) return <Badge tone="warning">{label}</Badge>;
  return <Badge tone="critical">{label}</Badge>;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const search = url.searchParams.get("search") || "";
  const marginFilter = url.searchParams.get("margin") || "all";
  const page = parseInt(url.searchParams.get("page") || "1");

  const where: any = { shop };

  if (search) {
    where.OR = [
      { productTitle: { contains: search, mode: "insensitive" } },
      { sku: { contains: search, mode: "insensitive" } },
      { variantTitle: { contains: search, mode: "insensitive" } },
    ];
  }

  if (marginFilter === "no-cost") {
    where.cost = null;
  } else if (marginFilter === "low") {
    where.marginPct = { lt: 20 };
    where.cost = { not: null };
  } else if (marginFilter === "medium") {
    where.marginPct = { gte: 20, lt: 40 };
  } else if (marginFilter === "high") {
    where.marginPct = { gte: 40 };
  }

  const [products, total, settings] = await Promise.all([
    db.productCost.findMany({
      where,
      orderBy: [{ productTitle: "asc" }, { variantTitle: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.productCost.count({ where }),
    getShopSettings(shop),
  ]);

  return json({
    products: products.map((p) => {
      const salePrice = Number(p.salePrice);
      const cost = p.cost !== null ? Number(p.cost) : null;
      const marginDollar = cost !== null ? salePrice - cost : null;
      return {
        id: p.id,
        productId: p.productId,
        variantId: p.variantId,
        productTitle: p.productTitle,
        variantTitle: p.variantTitle,
        sku: p.sku,
        salePrice,
        cost,
        marginPct: p.marginPct !== null ? Number(p.marginPct) : null,
        marginDollar,
      };
    }),
    total,
    page,
    totalPages: Math.ceil(total / PAGE_SIZE),
    search,
    marginFilter,
    alertThreshold: settings?.marginAlertThreshold
      ? Number(settings.marginAlertThreshold)
      : null,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "updateCost") {
      const variantId = formData.get("variantId") as string;
      const newCost = parseFloat(formData.get("cost") as string);
      if (isNaN(newCost) || newCost < 0) {
        return json({ error: "Invalid cost value" }, { status: 400 });
      }
      const result = await updateVariantCost(admin, shop, variantId, newCost);
      return json(result);
    }

    if (intent === "syncAll") {
      const result = await syncAllProductCosts(admin, shop);
      return json({ success: true, ...result });
    }

    return json({ error: "Unknown intent" }, { status: 400 });
  } catch (err) {
    console.error("Products action error:", err);
    return json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
};

function CostCell({
  variantId,
  currentCost,
}: {
  variantId: string;
  currentCost: number | null;
}) {
  const fetcher = useFetcher();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentCost?.toFixed(2) || "");
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      setEditing(false);
    }
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    setValue(currentCost?.toFixed(2) || "");
  }, [currentCost]);

  const handleSave = useCallback(() => {
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue >= 0 && numValue !== currentCost) {
      fetcher.submit(
        { intent: "updateCost", variantId, cost: value },
        { method: "POST" },
      );
    } else {
      setEditing(false);
    }
  }, [value, currentCost, variantId, fetcher]);

  if (isSubmitting) return <Spinner size="small" />;

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        type="button"
        style={{
          cursor: "pointer",
          background: "none",
          border: "none",
          padding: 0,
          textDecoration: "underline dotted",
          color: "inherit",
        }}
      >
        {currentCost !== null ? formatMoney(currentCost) : "Set cost"}
      </button>
    );
  }

  return (
    <div
      style={{ width: 140, display: "flex", gap: 4, alignItems: "center" }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <input
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") setEditing(false);
        }}
        autoFocus
        style={{
          width: 80,
          padding: "4px 6px",
          border: "1px solid #8c9196",
          borderRadius: 4,
          fontSize: 13,
        }}
        placeholder="0.00"
      />
      <Button size="slim" onClick={handleSave}>
        Save
      </Button>
    </div>
  );
}

export default function Products() {
  const { products, total, page, totalPages, search, marginFilter, alertThreshold } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const syncFetcher = useFetcher();
  const isSyncing = syncFetcher.state !== "idle";
  const [searchValue, setSearchValue] = useState(search);

  const handleSearch = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    if (searchValue) {
      params.set("search", searchValue);
    } else {
      params.delete("search");
    }
    params.set("page", "1");
    setSearchParams(params);
  }, [searchValue, searchParams, setSearchParams]);

  const handleFilterChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams);
      if (value !== "all") {
        params.set("margin", value);
      } else {
        params.delete("margin");
      }
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
      <TitleBar title="Products" />
      <BlockStack gap="400">
        {syncFetcher.data?.success && (
          <Banner title="Product sync complete" tone="success" onDismiss={() => {}}>
            <p>
              Synced {syncFetcher.data.totalVariants} variants (
              {syncFetcher.data.variantsWithCost} with costs).
            </p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <Card padding="400">
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="300" blockAlign="end">
                    <div
                      style={{ width: 300 }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSearch();
                      }}
                    >
                      <TextField
                        label=""
                        labelHidden
                        placeholder="Search products, SKUs..."
                        value={searchValue}
                        onChange={setSearchValue}
                        autoComplete="off"
                        clearButton
                        onClearButtonClick={() => {
                          setSearchValue("");
                          const params = new URLSearchParams(searchParams);
                          params.delete("search");
                          params.set("page", "1");
                          setSearchParams(params);
                        }}
                      />
                    </div>
                    <div style={{ width: 160 }}>
                      <Select
                        label=""
                        labelHidden
                        options={[
                          { label: "All margins", value: "all" },
                          { label: "No cost set", value: "no-cost" },
                          { label: "Low (<20%)", value: "low" },
                          { label: "Medium (20-40%)", value: "medium" },
                          { label: "High (40%+)", value: "high" },
                        ]}
                        value={marginFilter}
                        onChange={handleFilterChange}
                      />
                    </div>
                  </InlineStack>
                  <syncFetcher.Form method="POST">
                    <input type="hidden" name="intent" value="syncAll" />
                    <Button loading={isSyncing} submit>
                      Sync from Shopify
                    </Button>
                  </syncFetcher.Form>
                </InlineStack>

                {products.length === 0 ? (
                  <EmptyState
                    heading="No products synced yet"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>
                      Sync your products from the Setup page to see cost data
                      here.
                    </p>
                  </EmptyState>
                ) : (
                  <>
                    <IndexTable
                      resourceName={{
                        singular: "product variant",
                        plural: "product variants",
                      }}
                      itemCount={total}
                      headings={[
                        { title: "Product" },
                        { title: "Variant" },
                        { title: "SKU" },
                        { title: "Sale Price", alignment: "end" },
                        { title: "Cost", alignment: "end" },
                        { title: "Margin", alignment: "end" },
                      ]}
                      selectable={false}
                    >
                      {products.map((product, index) => (
                        <IndexTable.Row
                          id={product.id}
                          key={product.id}
                          position={index}
                        >
                          <IndexTable.Cell>
                            <a
                              href={`shopify://admin/products/${product.productId.replace("gid://shopify/Product/", "")}`}
                              target="_top"
                              style={{
                                color: "var(--p-color-text-emphasis)",
                                textDecoration: "none",
                                fontWeight: 600,
                              }}
                            >
                              {product.productTitle}
                            </a>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            {product.variantTitle || "Default"}
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Text as="span" tone="subdued">
                              {product.sku || "—"}
                            </Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Text as="span" alignment="end">
                              {formatMoney(product.salePrice)}
                            </Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <InlineStack align="end">
                              <CostCell
                                variantId={product.variantId}
                                currentCost={product.cost}
                              />
                            </InlineStack>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <InlineStack align="end">
                              <MarginBadge
                                margin={product.marginPct}
                                marginDollar={product.marginDollar}
                                alertThreshold={alertThreshold}
                              />
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
                      {Math.min(page * PAGE_SIZE, total)} of {total} variants
                    </Text>
                  </>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
