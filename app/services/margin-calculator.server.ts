import db from "../db.server";

export interface FeeConfig {
  rate: number; // percentage, e.g. 2.9
  flat: number; // flat fee per transaction, e.g. 0.30
}

export interface DashboardMetrics {
  totalRevenue: number;
  totalCogs: number;
  grossProfit: number;
  avgMarginPct: number;
  orderCount: number;
  totalTransactionFees: number;
  netProfit: number;
  netMarginPct: number;
  totalDiscounts: number;
  discountedOrderCount: number;
}

export interface TopProduct {
  productId: string;
  productTitle: string;
  unitsSold: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  marginPct: number;
}

export async function getShopSettings(shop: string) {
  return db.shopSettings.findUnique({ where: { shop } });
}

export async function getDashboardMetrics(
  shop: string,
  startDate: Date,
  endDate: Date,
  feeConfig?: FeeConfig,
): Promise<DashboardMetrics> {
  const lineItems = await db.orderLineItem.findMany({
    where: {
      shop,
      orderDate: { gte: startDate, lte: endDate },
    },
    select: {
      orderId: true,
      unitCost: true,
      quantity: true,
      revenue: true,
      grossProfit: true,
      discountAmount: true,
    },
  });

  let totalRevenue = 0;
  let totalCogs = 0;
  let totalDiscounts = 0;
  const orderRevenues = new Map<string, number>();
  const discountedOrders = new Set<string>();

  for (const li of lineItems) {
    const rev = Number(li.revenue);
    totalRevenue += rev;
    if (li.unitCost !== null) {
      totalCogs += Number(li.unitCost) * li.quantity;
    }
    if (li.discountAmount !== null && Number(li.discountAmount) > 0) {
      totalDiscounts += Number(li.discountAmount);
      discountedOrders.add(li.orderId);
    }
    // Accumulate revenue per order for fee calculation
    const existing = orderRevenues.get(li.orderId) || 0;
    orderRevenues.set(li.orderId, existing + rev);
  }

  const grossProfit = totalRevenue - totalCogs;
  const avgMarginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
  const orderCount = orderRevenues.size;

  // Calculate transaction fees per order
  let totalTransactionFees = 0;
  if (feeConfig && orderCount > 0) {
    for (const orderRev of orderRevenues.values()) {
      totalTransactionFees += (orderRev * feeConfig.rate) / 100 + feeConfig.flat;
    }
  }

  const netProfit = grossProfit - totalTransactionFees;
  const netMarginPct = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

  return {
    totalRevenue,
    totalCogs,
    grossProfit,
    avgMarginPct,
    orderCount,
    totalTransactionFees,
    netProfit,
    netMarginPct,
    totalDiscounts,
    discountedOrderCount: discountedOrders.size,
  };
}

export async function getAlertProducts(
  shop: string,
  threshold: number,
): Promise<
  Array<{
    productTitle: string;
    variantTitle: string;
    marginPct: number;
  }>
> {
  const products = await db.productCost.findMany({
    where: {
      shop,
      marginPct: { not: null, lt: threshold },
      cost: { not: null },
    },
    select: {
      productTitle: true,
      variantTitle: true,
      marginPct: true,
    },
    orderBy: { marginPct: "asc" },
    take: 50,
  });

  return products.map((p) => ({
    productTitle: p.productTitle,
    variantTitle: p.variantTitle,
    marginPct: Number(p.marginPct),
  }));
}

export async function getTopProducts(
  shop: string,
  startDate: Date,
  endDate: Date,
  limit: number = 10,
): Promise<TopProduct[]> {
  const lineItems = await db.orderLineItem.findMany({
    where: {
      shop,
      orderDate: { gte: startDate, lte: endDate },
      productId: { not: null },
    },
    select: {
      productId: true,
      productTitle: true,
      quantity: true,
      revenue: true,
      unitCost: true,
      grossProfit: true,
    },
  });

  const productMap = new Map<
    string,
    {
      productTitle: string;
      unitsSold: number;
      revenue: number;
      cogs: number;
      grossProfit: number;
    }
  >();

  for (const li of lineItems) {
    const pid = li.productId!;
    const existing = productMap.get(pid) || {
      productTitle: li.productTitle,
      unitsSold: 0,
      revenue: 0,
      cogs: 0,
      grossProfit: 0,
    };

    existing.unitsSold += li.quantity;
    existing.revenue += Number(li.revenue);
    existing.cogs += Number(li.unitCost || 0) * li.quantity;
    existing.grossProfit += Number(li.grossProfit || 0);

    productMap.set(pid, existing);
  }

  const sorted = Array.from(productMap.entries())
    .map(([productId, data]) => ({
      productId,
      ...data,
      marginPct: data.revenue > 0 ? (data.grossProfit / data.revenue) * 100 : 0,
    }))
    .sort((a, b) => b.grossProfit - a.grossProfit)
    .slice(0, limit);

  return sorted;
}

export async function getSnapshotData(
  shop: string,
  startDate: Date,
  endDate: Date,
): Promise<Array<{ date: string; revenue: number; grossProfit: number }>> {
  const lineItems = await db.orderLineItem.findMany({
    where: {
      shop,
      orderDate: { gte: startDate, lte: endDate },
    },
    select: {
      orderDate: true,
      revenue: true,
      grossProfit: true,
    },
    orderBy: { orderDate: "asc" },
  });

  const dayMap = new Map<string, { revenue: number; grossProfit: number }>();

  for (const li of lineItems) {
    const dateKey = li.orderDate.toISOString().split("T")[0];
    const existing = dayMap.get(dateKey) || { revenue: 0, grossProfit: 0 };
    existing.revenue += Number(li.revenue);
    existing.grossProfit += Number(li.grossProfit || 0);
    dayMap.set(dateKey, existing);
  }

  return Array.from(dayMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
