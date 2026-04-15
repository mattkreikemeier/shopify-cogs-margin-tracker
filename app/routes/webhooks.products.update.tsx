import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import { syncSingleProduct } from "../services/cost-sync.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const productGid = `gid://shopify/Product/${payload.id}`;

  let admin;
  try {
    const result = await unauthenticated.admin(shop);
    admin = result.admin;
  } catch (e) {
    console.error("Could not get admin API for shop:", shop);
    return new Response();
  }

  try {
    await syncSingleProduct(admin, shop, productGid);
  } catch (error) {
    console.error(`Error syncing product for ${shop}:`, error);
  }

  return new Response();
};
