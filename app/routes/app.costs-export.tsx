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
      salePrice: true,
      cost: true,
      marginPct: true,
    },
  });

  const lines = ["sku,product,variant,sale_price,cost,margin_pct"];
  for (const p of products) {
    const sku = (p.sku || "").replace(/"/g, '""');
    const product = p.productTitle.replace(/"/g, '""');
    const variant = (p.variantTitle || "").replace(/"/g, '""');
    const salePrice = Number(p.salePrice).toFixed(2);
    const cost = p.cost !== null ? Number(p.cost).toFixed(2) : "";
    const margin = p.marginPct !== null ? Number(p.marginPct).toFixed(1) : "";
    lines.push(`"${sku}","${product}","${variant}",${salePrice},${cost},${margin}`);
  }

  const csv = lines.join("\n");
  const date = new Date().toISOString().split("T")[0];

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="product-costs-${date}.csv"`,
    },
  });
};
