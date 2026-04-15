import db from "../db.server";

const ORDERS_QUERY = `#graphql
  query Orders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          name
          createdAt
          discountCodes
          lineItems(first: 100) {
            edges {
              node {
                id
                quantity
                originalUnitPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                discountAllocations {
                  allocatedAmountSet {
                    shopMoney {
                      amount
                    }
                  }
                  discountApplication {
                    ... on DiscountCodeApplication {
                      code
                    }
                  }
                }
                variant {
                  id
                  title
                  product {
                    id
                    title
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

function extractDiscountData(
  lineItem: any,
  orderDiscountCodes: string[],
): { discountAmount: number; discountCodes: string | null } {
  let discountAmount = 0;
  const codes = new Set<string>();

  for (const alloc of lineItem.discountAllocations || []) {
    const amount = parseFloat(alloc.allocatedAmountSet?.shopMoney?.amount || "0");
    discountAmount += amount;
    const code = alloc.discountApplication?.code;
    if (code) codes.add(code);
  }

  // Also include order-level discount codes
  for (const code of orderDiscountCodes) {
    if (code) codes.add(code);
  }

  return {
    discountAmount: discountAmount > 0 ? discountAmount : 0,
    discountCodes: codes.size > 0 ? Array.from(codes).join(",") : null,
  };
}

export async function syncHistoricalOrders(
  admin: any,
  shop: string,
  daysBack: number = 60,
  forceUpdate: boolean = false,
): Promise<{ ordersProcessed: number; lineItemsCreated: number }> {
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - daysBack);
  const query = `created_at:>='${sinceDate.toISOString().split("T")[0]}'`;

  let hasNextPage = true;
  let cursor: string | null = null;
  let ordersProcessed = 0;
  let lineItemsCreated = 0;

  while (hasNextPage) {
    const response = await admin.graphql(ORDERS_QUERY, {
      variables: { first: 50, after: cursor, query },
    });
    const data = await response.json();
    const orders = data.data.orders;

    for (const orderEdge of orders.edges) {
      const order = orderEdge.node;
      ordersProcessed++;

      const orderDiscountCodes: string[] = order.discountCodes || [];
      const inserts: any[] = [];

      for (const liEdge of order.lineItems.edges) {
        const li = liEdge.node;
        const variantId = li.variant?.id || null;
        const productId = li.variant?.product?.id || null;
        const unitPrice = parseFloat(
          li.originalUnitPriceSet?.shopMoney?.amount || "0",
        );
        const currency =
          li.originalUnitPriceSet?.shopMoney?.currencyCode || "USD";

        // Look up cost from our cache
        let unitCost: number | null = null;
        if (variantId) {
          const costRecord = await db.productCost.findUnique({
            where: { shop_variantId: { shop, variantId } },
          });
          unitCost = costRecord?.cost ? Number(costRecord.cost) : null;
        }

        const { discountAmount, discountCodes } = extractDiscountData(
          li,
          orderDiscountCodes,
        );

        const revenue = unitPrice * li.quantity;
        const grossProfit =
          unitCost !== null ? (unitPrice - unitCost) * li.quantity : null;
        const marginPct =
          unitCost !== null && unitPrice > 0
            ? ((unitPrice - unitCost) / unitPrice) * 100
            : null;

        const lineItemData = {
          shop,
          orderId: order.id,
          orderName: order.name,
          orderDate: new Date(order.createdAt),
          lineItemId: li.id,
          productId,
          variantId,
          productTitle: li.variant?.product?.title || "Unknown Product",
          variantTitle: li.variant?.title || "",
          quantity: li.quantity,
          unitPrice,
          unitCost,
          revenue,
          grossProfit,
          marginPct,
          discountAmount: discountAmount > 0 ? discountAmount : null,
          discountCodes,
          currency,
        };

        if (forceUpdate) {
          // Upsert mode: update existing records with new discount data
          await db.orderLineItem.upsert({
            where: { shop_lineItemId: { shop, lineItemId: li.id } },
            create: lineItemData,
            update: {
              discountAmount: lineItemData.discountAmount,
              discountCodes: lineItemData.discountCodes,
              unitCost: lineItemData.unitCost,
              grossProfit: lineItemData.grossProfit,
              marginPct: lineItemData.marginPct,
            },
          });
          lineItemsCreated++;
        } else {
          inserts.push(lineItemData);
        }
      }

      // Batch insert mode (default)
      if (!forceUpdate && inserts.length > 0) {
        await db.orderLineItem.createMany({
          data: inserts,
          skipDuplicates: true,
        });
        lineItemsCreated += inserts.length;
      }
    }

    hasNextPage = orders.pageInfo.hasNextPage;
    cursor = orders.pageInfo.endCursor;

    if (hasNextPage) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(
    `Order sync complete for ${shop}: ${ordersProcessed} orders, ${lineItemsCreated} line items${forceUpdate ? " (force update)" : ""}`,
  );

  return { ordersProcessed, lineItemsCreated };
}

export async function processNewOrder(
  shop: string,
  orderPayload: any,
): Promise<void> {
  const orderId = `gid://shopify/Order/${orderPayload.id}`;
  const orderName = orderPayload.name || `#${orderPayload.order_number}`;
  const orderDate = new Date(orderPayload.created_at);

  // Extract order-level discount codes from REST payload
  const orderDiscountCodes: string[] = (orderPayload.discount_codes || []).map(
    (dc: any) => dc.code,
  );

  const inserts: any[] = [];

  for (const li of orderPayload.line_items || []) {
    const variantId = li.variant_id
      ? `gid://shopify/ProductVariant/${li.variant_id}`
      : null;
    const productId = li.product_id
      ? `gid://shopify/Product/${li.product_id}`
      : null;
    const lineItemId = `gid://shopify/LineItem/${li.id}`;
    const unitPrice = parseFloat(li.price || "0");

    // Look up cost from cache (locked at order time)
    let unitCost: number | null = null;
    if (variantId) {
      const costRecord = await db.productCost.findUnique({
        where: { shop_variantId: { shop, variantId } },
      });
      unitCost = costRecord?.cost ? Number(costRecord.cost) : null;
    }

    // Extract discount from REST line item
    let discountAmount = 0;
    const codes = new Set<string>();
    for (const alloc of li.discount_allocations || []) {
      discountAmount += parseFloat(alloc.amount || "0");
    }
    for (const code of orderDiscountCodes) {
      if (code) codes.add(code);
    }

    const revenue = unitPrice * li.quantity;
    const grossProfit =
      unitCost !== null ? (unitPrice - unitCost) * li.quantity : null;
    const marginPct =
      unitCost !== null && unitPrice > 0
        ? ((unitPrice - unitCost) / unitPrice) * 100
        : null;

    inserts.push({
      shop,
      orderId,
      orderName,
      orderDate,
      lineItemId,
      productId,
      variantId,
      productTitle: li.title || "Unknown Product",
      variantTitle: li.variant_title || "",
      quantity: li.quantity,
      unitPrice,
      unitCost,
      revenue,
      grossProfit,
      marginPct,
      discountAmount: discountAmount > 0 ? discountAmount : null,
      discountCodes: codes.size > 0 ? Array.from(codes).join(",") : null,
      currency: orderPayload.currency || "USD",
    });
  }

  if (inserts.length > 0) {
    await db.orderLineItem.createMany({
      data: inserts,
      skipDuplicates: true,
    });
  }

  console.log(
    `Processed order ${orderName} for ${shop}: ${inserts.length} line items`,
  );
}
