/**
 * Seed script: creates fake OrderLineItem records for testing.
 * Run with: npx tsx scripts/seed-orders.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const SHOP = "leverage-badges-dev-2.myshopify.com";
const ORDER_COUNT = 45;
const DISCOUNT_CODES = ["SAVE10", "WINTER20", "LOYALTY15", "WELCOME5"];

async function main() {
  // Get all products with costs for realistic margins
  const products = await db.productCost.findMany({
    where: { shop: SHOP },
    select: {
      productId: true,
      variantId: true,
      productTitle: true,
      variantTitle: true,
      salePrice: true,
      cost: true,
    },
  });

  if (products.length === 0) {
    console.log("No products found. Sync products first.");
    return;
  }

  // Give costs to products that don't have them (for realistic data)
  const productsWithCosts = products.map((p) => ({
    ...p,
    salePrice: Number(p.salePrice),
    cost: p.cost !== null ? Number(p.cost) : Number(p.salePrice) * (0.3 + Math.random() * 0.3),
  }));

  const inserts: any[] = [];
  const now = new Date();

  for (let i = 0; i < ORDER_COUNT; i++) {
    // Random date in the last 90 days
    const daysAgo = Math.floor(Math.random() * 90);
    const orderDate = new Date(now);
    orderDate.setDate(orderDate.getDate() - daysAgo);

    const orderId = `gid://shopify/Order/fake-${1000 + i}`;
    const orderName = `#${1001 + i}`;

    // 1-4 line items per order
    const lineItemCount = 1 + Math.floor(Math.random() * 4);

    // 30% chance of having a discount
    const hasDiscount = Math.random() < 0.3;
    const discountCode = hasDiscount
      ? DISCOUNT_CODES[Math.floor(Math.random() * DISCOUNT_CODES.length)]
      : null;
    const discountPct = discountCode
      ? parseInt(discountCode.match(/\d+/)?.[0] || "10")
      : 0;

    for (let j = 0; j < lineItemCount; j++) {
      const product =
        productsWithCosts[Math.floor(Math.random() * productsWithCosts.length)];
      const quantity = 1 + Math.floor(Math.random() * 3);
      const unitPrice = product.salePrice;
      const unitCost = product.cost;
      const revenue = unitPrice * quantity;
      const discountAmount = hasDiscount
        ? (revenue * discountPct) / 100
        : 0;
      const grossProfit = (unitPrice - unitCost) * quantity;
      const marginPct =
        unitPrice > 0 ? ((unitPrice - unitCost) / unitPrice) * 100 : 0;

      inserts.push({
        shop: SHOP,
        orderId,
        orderName,
        orderDate,
        lineItemId: `gid://shopify/LineItem/fake-${1000 + i}-${j}`,
        productId: product.productId,
        variantId: product.variantId,
        productTitle: product.productTitle,
        variantTitle: product.variantTitle || "",
        quantity,
        unitPrice,
        unitCost,
        revenue,
        grossProfit,
        marginPct,
        discountAmount: discountAmount > 0 ? discountAmount : null,
        discountCodes: discountCode,
        currency: "USD",
      });
    }
  }

  // Clear existing fake orders first
  const deleted = await db.orderLineItem.deleteMany({
    where: {
      shop: SHOP,
      orderId: { startsWith: "gid://shopify/Order/fake-" },
    },
  });
  console.log(`Cleared ${deleted.count} existing fake orders`);

  // Insert new ones
  await db.orderLineItem.createMany({
    data: inserts,
    skipDuplicates: true,
  });

  // Summary
  const totalRevenue = inserts.reduce((sum, li) => sum + li.revenue, 0);
  const totalCogs = inserts.reduce((sum, li) => sum + li.unitCost * li.quantity, 0);
  const totalDiscounts = inserts.reduce(
    (sum, li) => sum + (li.discountAmount || 0),
    0,
  );
  const discountOrders = new Set(
    inserts.filter((li) => li.discountCodes).map((li) => li.orderId),
  ).size;

  console.log(`\nSeeded ${ORDER_COUNT} orders with ${inserts.length} line items`);
  console.log(`  Revenue: $${totalRevenue.toFixed(2)}`);
  console.log(`  COGS: $${totalCogs.toFixed(2)}`);
  console.log(`  Gross Profit: $${(totalRevenue - totalCogs).toFixed(2)}`);
  console.log(`  Discounted orders: ${discountOrders} (codes: ${DISCOUNT_CODES.join(", ")})`);
  console.log(`  Total discounts: $${totalDiscounts.toFixed(2)}`);

  await db.$disconnect();
}

main().catch(console.error);
