import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  DropZone,
  Banner,
  DataTable,
  Box,
  List,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { updateVariantCost } from "../services/cost-writer.server";

interface CsvRow {
  sku: string;
  cost: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const variantCount = await db.productCost.count({ where: { shop } });
  return json({ variantCount });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "import") {
    const rowsJson = formData.get("rows") as string;
    let rows: CsvRow[];
    try {
      rows = JSON.parse(rowsJson);
    } catch {
      return json({ error: "Invalid data format" }, { status: 400 });
    }

    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of rows) {
      if (!row.sku || isNaN(row.cost) || row.cost < 0) {
        skipped++;
        continue;
      }

      const productCost = await db.productCost.findFirst({
        where: { shop, sku: row.sku },
      });

      if (!productCost) {
        errors.push(`SKU "${row.sku}" not found`);
        skipped++;
        continue;
      }

      try {
        await updateVariantCost(admin, shop, productCost.variantId, row.cost);
        updated++;
      } catch (e: any) {
        errors.push(`SKU "${row.sku}": ${e.message}`);
        skipped++;
      }
    }

    return json({
      success: true,
      updated,
      skipped,
      errors: errors.slice(0, 10),
    });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

export default function ImportCosts() {
  const { variantCount } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [parsedRows, setParsedRows] = useState<CsvRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const isSubmitting = fetcher.state !== "idle";

  const handleDrop = useCallback(
    (_dropFiles: File[], acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      setFileName(file.name);
      setParseError(null);

      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        try {
          const lines = text.split("\n");
          const header = lines[0]?.toLowerCase().trim();

          const headers = header.split(",").map((h) => h.trim());
          const skuIdx = headers.indexOf("sku");
          const costIdx = headers.includes("new_cost")
            ? headers.indexOf("new_cost")
            : headers.indexOf("cost");

          if (skuIdx === -1 || costIdx === -1) {
            setParseError(
              'CSV must have "sku" and "cost" (or "new_cost") columns in the header row.',
            );
            return;
          }

          const rows: CsvRow[] = [];
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const cols = line.split(",").map((c) => c.trim().replace(/"/g, ""));
            const sku = cols[skuIdx];
            const cost = parseFloat(cols[costIdx]);

            if (sku && !isNaN(cost)) {
              rows.push({ sku, cost });
            }
          }

          if (rows.length === 0) {
            setParseError("No valid rows found in CSV.");
            return;
          }

          setParsedRows(rows);
        } catch {
          setParseError("Failed to parse CSV file.");
        }
      };
      reader.readAsText(file);
    },
    [],
  );

  const handleImport = useCallback(() => {
    fetcher.submit(
      { intent: "import", rows: JSON.stringify(parsedRows) },
      { method: "POST" },
    );
  }, [fetcher, parsedRows]);

  const handleClear = useCallback(() => {
    setParsedRows([]);
    setFileName(null);
    setParseError(null);
  }, []);

  return (
    <Page>
      <TitleBar title="Import Costs" />
      <BlockStack gap="400">
        {fetcher.data?.success && (
          <Banner title="Import complete" tone="success" onDismiss={handleClear}>
            <p>
              Updated {fetcher.data.updated} variants. Skipped{" "}
              {fetcher.data.skipped}.
            </p>
            {fetcher.data.errors?.length > 0 && (
              <List>
                {fetcher.data.errors.map((err: string, i: number) => (
                  <List.Item key={i}>{err}</List.Item>
                ))}
              </List>
            )}
          </Banner>
        )}

        {fetcher.data?.error && (
          <Banner title="Import failed" tone="critical">
            <p>{fetcher.data.error}</p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Bulk Import Costs via CSV
                </Text>
                <Text as="p" tone="subdued">
                  Upload a CSV file with <strong>sku</strong> and{" "}
                  <strong>cost</strong> columns to update product costs in bulk.
                  You have {variantCount} synced variants.
                </Text>
                <InlineStack gap="300">
                  <Button url="/app/costs-template" variant="primary">
                    Download import template
                  </Button>
                  <Button url="/app/costs-export">
                    Download current costs (CSV)
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Upload CSV
                </Text>

                {parseError && (
                  <Banner title="Parse error" tone="warning">
                    <p>{parseError}</p>
                  </Banner>
                )}

                {parsedRows.length === 0 ? (
                  <DropZone
                    accept=".csv,text/csv"
                    type="file"
                    onDrop={handleDrop}
                    allowMultiple={false}
                  >
                    <DropZone.FileUpload
                      actionHint="or drop a CSV file"
                      actionTitle="Add file"
                    />
                  </DropZone>
                ) : (
                  <BlockStack gap="400">
                    <Banner tone="info">
                      <p>
                        Previewing <strong>{fileName}</strong>:{" "}
                        {parsedRows.length} rows ready to import.
                      </p>
                    </Banner>

                    <DataTable
                      columnContentTypes={["text", "numeric"]}
                      headings={["SKU", "Cost"]}
                      rows={parsedRows.slice(0, 20).map((r) => [
                        r.sku,
                        `$${r.cost.toFixed(2)}`,
                      ])}
                    />

                    {parsedRows.length > 20 && (
                      <Text as="p" tone="subdued">
                        ...and {parsedRows.length - 20} more rows
                      </Text>
                    )}

                    <InlineStack gap="300">
                      <Button
                        variant="primary"
                        onClick={handleImport}
                        loading={isSubmitting}
                      >
                        Import {parsedRows.length} costs
                      </Button>
                      <Button onClick={handleClear}>Cancel</Button>
                    </InlineStack>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  CSV Format
                </Text>
                <Text as="p" tone="subdued">
                  Your CSV must have a header row with <strong>sku</strong> and
                  either <strong>cost</strong> or <strong>new_cost</strong>{" "}
                  columns. The easiest way is to download the import template
                  above, fill in the new_cost column, and re-upload.
                </Text>
                <Box
                  padding="300"
                  background="bg-surface-secondary"
                  borderRadius="200"
                >
                  <Text as="p" variant="bodyMd">
                    sku,cost
                    <br />
                    WIDGET-001,12.50
                    <br />
                    WIDGET-002,8.75
                  </Text>
                </Box>
                <Text as="p" tone="subdued">
                  SKUs must match your Shopify product SKUs exactly. Costs are
                  in your store's currency.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
