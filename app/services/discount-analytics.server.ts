import db from "../db.server";

export interface DiscountCodeBreakdown {
  code: string;
  orderCount: number;
  totalRevenue: number;
  totalDiscount: number;
  totalProfit: number;
  avgMarginPct: number;
}

export interface DiscountAnalysis {
  totalDiscountAmount: number;
  discountedOrderCount: number;
  totalOrderCount: number;
  discountedAvgMargin: number;
  nonDiscountedAvgMargin: number;
  discountedAvgOrderValue: number;
  nonDiscountedAvgOrderValue: number;
  byCode: DiscountCodeBreakdown[];
}

export async function getDiscountAnalysis(
  shop: string,
  startDate: Date,
  endDate: Date,
): Promise<DiscountAnalysis> {
  const allLineItems = await db.orderLineItem.findMany({
    where: {
      shop,
      orderDate: { gte: startDate, lte: endDate },
    },
    select: {
      orderId: true,
      revenue: true,
      grossProfit: true,
      discountAmount: true,
      discountCodes: true,
    },
  });

  // Aggregate by order first
  const orderMap = new Map<
    string,
    {
      revenue: number;
      profit: number;
      discountAmount: number;
      codes: Set<string>;
    }
  >();

  for (const li of allLineItems) {
    const existing = orderMap.get(li.orderId) || {
      revenue: 0,
      profit: 0,
      discountAmount: 0,
      codes: new Set<string>(),
    };
    existing.revenue += Number(li.revenue);
    existing.profit += Number(li.grossProfit || 0);
    if (li.discountAmount !== null) {
      existing.discountAmount += Number(li.discountAmount);
    }
    if (li.discountCodes) {
      for (const c of li.discountCodes.split(",")) {
        const trimmed = c.trim();
        if (trimmed) existing.codes.add(trimmed);
      }
    }
    orderMap.set(li.orderId, existing);
  }

  let totalDiscountAmount = 0;
  let discountedRevenue = 0;
  let discountedProfit = 0;
  let discountedOrderCount = 0;
  let nonDiscountedRevenue = 0;
  let nonDiscountedProfit = 0;
  let nonDiscountedOrderCount = 0;

  // Per-code tracking
  const codeMap = new Map<
    string,
    { orderCount: number; revenue: number; discount: number; profit: number }
  >();

  for (const order of orderMap.values()) {
    if (order.discountAmount > 0) {
      totalDiscountAmount += order.discountAmount;
      discountedRevenue += order.revenue;
      discountedProfit += order.profit;
      discountedOrderCount++;

      // Attribute to codes
      for (const code of order.codes) {
        const existing = codeMap.get(code) || {
          orderCount: 0,
          revenue: 0,
          discount: 0,
          profit: 0,
        };
        existing.orderCount++;
        existing.revenue += order.revenue;
        existing.discount += order.discountAmount / order.codes.size;
        existing.profit += order.profit;
        codeMap.set(code, existing);
      }
    } else {
      nonDiscountedRevenue += order.revenue;
      nonDiscountedProfit += order.profit;
      nonDiscountedOrderCount++;
    }
  }

  const discountedAvgMargin =
    discountedRevenue > 0
      ? (discountedProfit / discountedRevenue) * 100
      : 0;
  const nonDiscountedAvgMargin =
    nonDiscountedRevenue > 0
      ? (nonDiscountedProfit / nonDiscountedRevenue) * 100
      : 0;
  const discountedAvgOrderValue =
    discountedOrderCount > 0
      ? discountedRevenue / discountedOrderCount
      : 0;
  const nonDiscountedAvgOrderValue =
    nonDiscountedOrderCount > 0
      ? nonDiscountedRevenue / nonDiscountedOrderCount
      : 0;

  const byCode = Array.from(codeMap.entries())
    .map(([code, data]) => ({
      code,
      orderCount: data.orderCount,
      totalRevenue: data.revenue,
      totalDiscount: data.discount,
      totalProfit: data.profit,
      avgMarginPct:
        data.revenue > 0 ? (data.profit / data.revenue) * 100 : 0,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  return {
    totalDiscountAmount,
    discountedOrderCount,
    totalOrderCount: orderMap.size,
    discountedAvgMargin,
    nonDiscountedAvgMargin,
    discountedAvgOrderValue,
    nonDiscountedAvgOrderValue,
    byCode,
  };
}
