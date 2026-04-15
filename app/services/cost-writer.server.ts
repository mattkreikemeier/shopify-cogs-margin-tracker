import db from "../db.server";

const INVENTORY_ITEM_UPDATE_MUTATION = `#graphql
  mutation InventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem {
        id
        unitCost {
          amount
          currencyCode
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Update a variant's cost in the local database.
 * Optionally syncs to Shopify if write_inventory scope is available.
 */
export async function updateVariantCost(
  admin: any,
  shop: string,
  variantId: string,
  newCost: number,
): Promise<{ success: boolean; error?: string }> {
  const productCost = await db.productCost.findUnique({
    where: { shop_variantId: { shop, variantId } },
  });

  if (!productCost) {
    return { success: false, error: "Variant not found in database" };
  }

  const salePrice = Number(productCost.salePrice || 0);
  const marginPct =
    salePrice > 0 ? ((salePrice - newCost) / salePrice) * 100 : null;

  // Try to sync to Shopify if we have the inventoryItemId
  if (productCost.inventoryItemId) {
    try {
      const response = await admin.graphql(INVENTORY_ITEM_UPDATE_MUTATION, {
        variables: {
          id: productCost.inventoryItemId,
          input: { cost: newCost },
        },
      });
      const data = await response.json();
      const errors = data.data?.inventoryItemUpdate?.userErrors;
      if (errors && errors.length > 0) {
        console.warn(`Shopify cost update failed for ${variantId}:`, errors[0].message);
      } else {
        console.log(`Synced cost to Shopify for ${variantId}`);
      }
    } catch (e: any) {
      // write_inventory scope not available — save locally only
      console.log(`Saving cost locally only (Shopify sync unavailable): ${e.message?.slice(0, 80)}`);
    }
  }

  // Always update local database
  await db.productCost.update({
    where: { shop_variantId: { shop, variantId } },
    data: {
      cost: newCost,
      marginPct,
      syncedAt: new Date(),
    },
  });

  console.log(`Updated cost for ${variantId} to ${newCost} (margin: ${marginPct?.toFixed(1)}%)`);

  return { success: true };
}
