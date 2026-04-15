import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  TextField,
  Select,
  BlockStack,
  InlineStack,
  InlineGrid,
  Button,
  IndexTable,
  Banner,
  EmptyState,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";

import { authenticate } from "../shopify.server";
import {
  getExpenses,
  createExpense,
  deleteExpense,
} from "../services/expense-calculator.server";

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function normalizeToMonthly(amount: number, frequency: string): number {
  switch (frequency) {
    case "weekly":
      return amount * 4.33;
    case "yearly":
      return amount / 12;
    default:
      return amount;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const expenses = await getExpenses(shop);

  let totalMonthly = 0;
  const mapped = expenses.map((e) => {
    const monthly = normalizeToMonthly(Number(e.amount), e.frequency);
    totalMonthly += e.isActive ? monthly : 0;
    return {
      id: e.id,
      name: e.name,
      category: e.category,
      amount: Number(e.amount),
      frequency: e.frequency,
      allocationMethod: e.allocationMethod,
      isActive: e.isActive,
      monthlyEquivalent: monthly,
    };
  });

  return json({ expenses: mapped, totalMonthly });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "create") {
      const name = (formData.get("name") as string)?.trim();
      const category = formData.get("category") as string;
      const amount = parseFloat(formData.get("amount") as string);
      const frequency = formData.get("frequency") as string;
      const allocationMethod = formData.get("allocationMethod") as string;

      if (!name || isNaN(amount) || amount <= 0) {
        return json({ error: "Name and a positive amount are required" }, { status: 400 });
      }

      await createExpense(shop, {
        name,
        category,
        amount,
        frequency,
        allocationMethod,
      });
      return json({ success: true });
    }

    if (intent === "delete") {
      const id = formData.get("id") as string;
      await deleteExpense(id, shop);
      return json({ success: true });
    }

    return json({ error: "Unknown intent" }, { status: 400 });
  } catch (err) {
    console.error("Expense action error:", err);
    return json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
};

const CATEGORY_OPTIONS = [
  { label: "Advertising", value: "Advertising" },
  { label: "Shipping", value: "Shipping" },
  { label: "Factory / Supplier", value: "Factory" },
  { label: "Software / Tools", value: "Software" },
  { label: "Other", value: "Other" },
];

const FREQUENCY_OPTIONS = [
  { label: "Weekly", value: "weekly" },
  { label: "Monthly", value: "monthly" },
  { label: "Yearly", value: "yearly" },
];

const ALLOCATION_OPTIONS = [
  { label: "Proportional to revenue", value: "proportional" },
  { label: "Split evenly", value: "even" },
];

export default function Expenses() {
  const { expenses, totalMonthly } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const deleteFetcher = useFetcher();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Other");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("monthly");
  const [allocationMethod, setAllocationMethod] = useState("proportional");

  const isSubmitting = fetcher.state !== "idle";

  const resetForm = useCallback(() => {
    setName("");
    setCategory("Other");
    setAmount("");
    setFrequency("monthly");
    setAllocationMethod("proportional");
    setShowForm(false);
  }, []);

  const handleSubmit = useCallback(() => {
    fetcher.submit(
      { intent: "create", name, category, amount, frequency, allocationMethod },
      { method: "POST" },
    );
    resetForm();
  }, [fetcher, name, category, amount, frequency, allocationMethod, resetForm]);

  return (
    <Page>
      <TitleBar title="Expenses" />
      <BlockStack gap="400">
        {fetcher.data?.error && (
          <Banner title="Error" tone="critical">
            <p>{fetcher.data.error}</p>
          </Banner>
        )}

        <Banner tone="info" title="Avoid double-counting">
          <p>
            Only add expenses here that are <strong>not</strong> already
            included in your per-product "Cost per item" in Shopify. For
            example, if your product cost of $40 already includes $5 of
            advertising overhead, don't also add that advertising cost here —
            it would be counted twice.
          </p>
          <p>
            This feature is best for overhead costs like rent, software
            subscriptions, or advertising spend that isn't baked into individual
            product costs.
          </p>
        </Banner>

        {expenses.length > 0 && (
          <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
            <Card>
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">
                  Total Monthly Overhead
                </Text>
                <Text as="p" variant="headingLg">
                  {formatMoney(totalMonthly)}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {formatMoney(totalMonthly * 12)} / year
                </Text>
              </BlockStack>
            </Card>
          </InlineGrid>
        )}

        <Layout>
          <Layout.Section>
            <Card padding="400">
              {expenses.length === 0 && !showForm ? (
                <EmptyState
                  heading="Track overhead expenses"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  action={{
                    content: "Add your first expense",
                    onAction: () => setShowForm(true),
                  }}
                >
                  <p>
                    Add recurring expenses like advertising, shipping, or
                    supplier costs to see adjusted profit margins on your
                    dashboard. This is completely optional — your regular COGS
                    margins work without it.
                  </p>
                </EmptyState>
              ) : (
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      Recurring Expenses
                    </Text>
                    {!showForm && (
                      <Button onClick={() => setShowForm(true)}>
                        Add expense
                      </Button>
                    )}
                  </InlineStack>

                  {showForm && (
                    <Card>
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">
                          New Expense
                        </Text>
                        <InlineGrid
                          columns={{ xs: 1, sm: 2, md: 3 }}
                          gap="300"
                        >
                          <TextField
                            label="Name"
                            value={name}
                            onChange={setName}
                            autoComplete="off"
                            placeholder="e.g. Facebook Ads"
                          />
                          <Select
                            label="Category"
                            options={CATEGORY_OPTIONS}
                            value={category}
                            onChange={setCategory}
                          />
                          <TextField
                            label="Amount"
                            type="number"
                            value={amount}
                            onChange={setAmount}
                            autoComplete="off"
                            prefix="$"
                            min={0}
                            step={0.01}
                          />
                        </InlineGrid>
                        <InlineGrid
                          columns={{ xs: 1, sm: 2 }}
                          gap="300"
                        >
                          <Select
                            label="Frequency"
                            options={FREQUENCY_OPTIONS}
                            value={frequency}
                            onChange={setFrequency}
                          />
                          <Select
                            label="Allocation method"
                            options={ALLOCATION_OPTIONS}
                            value={allocationMethod}
                            onChange={setAllocationMethod}
                          />
                        </InlineGrid>
                        <InlineStack gap="200">
                          <Button
                            variant="primary"
                            onClick={handleSubmit}
                            loading={isSubmitting}
                          >
                            Save expense
                          </Button>
                          <Button onClick={resetForm}>Cancel</Button>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  )}

                  {expenses.length > 0 && (
                    <IndexTable
                      resourceName={{
                        singular: "expense",
                        plural: "expenses",
                      }}
                      itemCount={expenses.length}
                      headings={[
                        { title: "Name" },
                        { title: "Category" },
                        { title: "Amount" },
                        { title: "Frequency" },
                        { title: "Monthly Equivalent", alignment: "end" },
                        { title: "" },
                      ]}
                      selectable={false}
                    >
                      {expenses.map((exp, index) => (
                        <IndexTable.Row
                          id={exp.id}
                          key={exp.id}
                          position={index}
                        >
                          <IndexTable.Cell>
                            <Text
                              as="span"
                              fontWeight="semibold"
                              variant="bodyMd"
                            >
                              {exp.name}
                            </Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Badge>{exp.category}</Badge>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            {formatMoney(exp.amount)}
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            {exp.frequency.charAt(0).toUpperCase() +
                              exp.frequency.slice(1)}
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Text as="span" alignment="end">
                              {formatMoney(exp.monthlyEquivalent)}/mo
                            </Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <deleteFetcher.Form method="POST">
                              <input
                                type="hidden"
                                name="intent"
                                value="delete"
                              />
                              <input type="hidden" name="id" value={exp.id} />
                              <Button
                                variant="plain"
                                tone="critical"
                                submit
                              >
                                Delete
                              </Button>
                            </deleteFetcher.Form>
                          </IndexTable.Cell>
                        </IndexTable.Row>
                      ))}
                    </IndexTable>
                  )}
                </BlockStack>
              )}
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
