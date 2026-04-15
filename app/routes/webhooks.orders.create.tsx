import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { processNewOrder } from "../services/order-sync.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    await processNewOrder(shop, payload);
  } catch (error) {
    console.error(`Error processing order for ${shop}:`, error);
  }

  return new Response();
};
