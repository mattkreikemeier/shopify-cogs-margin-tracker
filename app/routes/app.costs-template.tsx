import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { requirePro } from "../services/billing.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  // The Import Costs page is Pro-only, but these are resource routes a
  // free shop could hit by URL. Gate them too so the listing's "bulk CSV
  // import/export" promise holds at the endpoint, not just the page.
  await requirePro(admin, "import");
  const shop = session.shop;

  const products = await db.productCost.findMany({
    where: { shop },
    orderBy: [{ productTitle: "asc" }, { variantTitle: "asc" }],
    select: {
      sku: true,
      productTitle: true,
      variantTitle: true,
      cost: true,
    },
  });

  const lines = ["sku,product_title,variant_title,current_cost,new_cost"];
  for (const p of products) {
    const sku = (p.sku || "").replace(/"/g, '""');
    const product = p.productTitle.replace(/"/g, '""');
    const variant = (p.variantTitle || "").replace(/"/g, '""');
    const cost = p.cost !== null ? Number(p.cost).toFixed(2) : "";
    lines.push(`"${sku}","${product}","${variant}",${cost},`);
  }

  const csv = lines.join("\n");
  const date = new Date().toISOString().split("T")[0];

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="cost-import-template-${date}.csv"`,
    },
  });
};
