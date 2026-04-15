import db from "../db.server";

interface SyncResult {
  totalProducts: number;
  totalVariants: number;
  variantsWithCost: number;
  variantsWithoutCost: number;
}

const PRODUCTS_QUERY = `#graphql
  query ProductCosts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                price
                inventoryItem {
                  id
                  unitCost {
                    amount
                    currencyCode
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

const SINGLE_PRODUCT_QUERY = `#graphql
  query SingleProductCosts($id: ID!) {
    product(id: $id) {
      id
      title
      variants(first: 100) {
        edges {
          node {
            id
            title
            sku
            price
            inventoryItem {
              id
              unitCost {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  }
`;

function computeMargin(salePrice: number, cost: number | null): number | null {
  if (cost === null || cost === undefined || salePrice <= 0) return null;
  return ((salePrice - cost) / salePrice) * 100;
}

export async function syncAllProductCosts(
  admin: any,
  shop: string,
): Promise<SyncResult> {
  let hasNextPage = true;
  let cursor: string | null = null;
  let totalProducts = 0;
  let totalVariants = 0;
  let variantsWithCost = 0;
  let variantsWithoutCost = 0;

  while (hasNextPage) {
    const response = await admin.graphql(PRODUCTS_QUERY, {
      variables: { first: 50, after: cursor },
    });
    const data = await response.json();

    const products = data.data.products;

    const upserts: any[] = [];

    for (const edge of products.edges) {
      const product = edge.node;
      totalProducts++;

      for (const variantEdge of product.variants.edges) {
        const variant = variantEdge.node;
        totalVariants++;

        const salePrice = parseFloat(variant.price);
        const unitCost = variant.inventoryItem?.unitCost?.amount
          ? parseFloat(variant.inventoryItem.unitCost.amount)
          : null;
        const currency =
          variant.inventoryItem?.unitCost?.currencyCode || "USD";
        const marginPct = computeMargin(salePrice, unitCost);

        if (unitCost !== null) {
          variantsWithCost++;
        } else {
          variantsWithoutCost++;
        }

        upserts.push(
          db.productCost.upsert({
            where: {
              shop_variantId: { shop, variantId: variant.id },
            },
            create: {
              shop,
              productId: product.id,
              variantId: variant.id,
              inventoryItemId: variant.inventoryItem?.id || null,
              productTitle: product.title,
              variantTitle: variant.title || "",
              sku: variant.sku || "",
              salePrice,
              cost: unitCost,
              marginPct,
              currency,
              syncedAt: new Date(),
            },
            update: {
              productTitle: product.title,
              variantTitle: variant.title || "",
              sku: variant.sku || "",
              salePrice,
              cost: unitCost,
              marginPct,
              inventoryItemId: variant.inventoryItem?.id || null,
              currency,
              syncedAt: new Date(),
            },
          }),
        );
      }
    }

    // Batch upsert in a transaction
    if (upserts.length > 0) {
      await db.$transaction(upserts);
    }

    hasNextPage = products.pageInfo.hasNextPage;
    cursor = products.pageInfo.endCursor;

    // Rate limit safety: pause between pages
    if (hasNextPage) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(
    `Cost sync complete for ${shop}: ${totalProducts} products, ${totalVariants} variants (${variantsWithCost} with cost, ${variantsWithoutCost} without)`,
  );

  return { totalProducts, totalVariants, variantsWithCost, variantsWithoutCost };
}

export async function syncSingleProduct(
  admin: any,
  shop: string,
  productGid: string,
): Promise<void> {
  const response = await admin.graphql(SINGLE_PRODUCT_QUERY, {
    variables: { id: productGid },
  });
  const data = await response.json();
  const product = data.data?.product;

  if (!product) {
    console.log(`Product ${productGid} not found for ${shop}`);
    return;
  }

  const upserts: any[] = [];

  for (const variantEdge of product.variants.edges) {
    const variant = variantEdge.node;
    const salePrice = parseFloat(variant.price);
    const unitCost = variant.inventoryItem?.unitCost?.amount
      ? parseFloat(variant.inventoryItem.unitCost.amount)
      : null;
    const currency =
      variant.inventoryItem?.unitCost?.currencyCode || "USD";
    const marginPct = computeMargin(salePrice, unitCost);

    upserts.push(
      db.productCost.upsert({
        where: {
          shop_variantId: { shop, variantId: variant.id },
        },
        create: {
          shop,
          productId: product.id,
          variantId: variant.id,
          inventoryItemId: variant.inventoryItem?.id || null,
          productTitle: product.title,
          variantTitle: variant.title || "",
          sku: variant.sku || "",
          salePrice,
          cost: unitCost,
          marginPct,
          currency,
          syncedAt: new Date(),
        },
        update: {
          productTitle: product.title,
          variantTitle: variant.title || "",
          sku: variant.sku || "",
          salePrice,
          cost: unitCost,
          marginPct,
          inventoryItemId: variant.inventoryItem?.id || null,
          currency,
          syncedAt: new Date(),
        },
      }),
    );
  }

  if (upserts.length > 0) {
    await db.$transaction(upserts);
  }

  console.log(
    `Synced product ${product.title} (${product.variants.edges.length} variants) for ${shop}`,
  );
}
