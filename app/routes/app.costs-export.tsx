import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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
