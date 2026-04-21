import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const inventoryItemGid = `gid://shopify/InventoryItem/${payload.id}`;
    const newCost = payload.cost ? parseFloat(payload.cost) : null;

    const productCost = await db.productCost.findFirst({
      where: { shop, inventoryItemId: inventoryItemGid },
    });

    if (!productCost) {
      console.log(`No ProductCost found for inventory item ${inventoryItemGid}`);
      return new Response();
    }

    const salePrice = Number(productCost.salePrice);
    const marginPct =
      newCost !== null && salePrice > 0
        ? ((salePrice - newCost) / salePrice) * 100
        : null;

    await db.productCost.update({
      where: { id: productCost.id },
      data: {
        cost: newCost,
        marginPct,
        syncedAt: new Date(),
      },
    });

    console.log(
      `Updated cost for ${productCost.productTitle} (${productCost.variantTitle}) to ${newCost} via inventory_items/update webhook`,
    );
  } catch (error) {
    console.error(`Error handling inventory_items/update for ${shop}:`, error);
  }

  return new Response();
};
