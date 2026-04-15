import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    await db.aiAnalysisCache.deleteMany({ where: { shop } });
    await db.expense.deleteMany({ where: { shop } });
    await db.shopSettings.deleteMany({ where: { shop } });
    await db.marginSnapshot.deleteMany({ where: { shop } });
    await db.orderLineItem.deleteMany({ where: { shop } });
    await db.productCost.deleteMany({ where: { shop } });
    await db.session.deleteMany({ where: { shop } });
  } catch (err) {
    console.error(`Error redacting data for ${shop}:`, err);
  }

  return new Response();
};
