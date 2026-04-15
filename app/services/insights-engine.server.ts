import type { DashboardMetrics, TopProduct } from "./margin-calculator.server";
import type { DiscountAnalysis } from "./discount-analytics.server";
import type { ExpenseSummary } from "./expense-calculator.server";

export interface Insight {
  id: string;
  type: "warning" | "opportunity" | "info" | "success";
  title: string;
  description: string;
  priority: number;
}

export interface InsightInput {
  metrics: DashboardMetrics;
  topProducts: TopProduct[];
  chartData: Array<{ date: string; revenue: number; grossProfit: number }>;
  discountAnalysis: DiscountAnalysis | null;
  expenseData: ExpenseSummary | null;
  totalVariants: number;
  variantsWithCost: number;
  range: string;
}

export function generateInsights(input: InsightInput): Insight[] {
  const insights: Insight[] = [];

  costCoverageGap(input, insights);
  marginTrend(input, insights);
  profitConcentration(input, insights);
  highMarginLowVolume(input, insights);
  discountEffectiveness(input, insights);
  worstDiscountCode(input, insights);
  weekendPattern(input, insights);
  expenseImpact(input, insights);

  return insights.sort((a, b) => a.priority - b.priority);
}

function costCoverageGap(input: InsightInput, insights: Insight[]) {
  const { totalVariants, variantsWithCost } = input;
  if (totalVariants === 0) return;

  const missingPct = ((totalVariants - variantsWithCost) / totalVariants) * 100;
  if (missingPct > 20) {
    insights.push({
      id: "cost-coverage",
      type: "warning",
      title: "Incomplete cost data",
      description: `${Math.round(missingPct)}% of your products (${totalVariants - variantsWithCost} of ${totalVariants}) have no cost set — margin calculations are incomplete for those items.`,
      priority: 1,
    });
  } else if (missingPct > 0 && missingPct <= 20) {
    insights.push({
      id: "cost-coverage",
      type: "info",
      title: "Nearly complete cost data",
      description: `${totalVariants - variantsWithCost} of ${totalVariants} variants are missing costs. Add them for full margin visibility.`,
      priority: 8,
    });
  }
}

function marginTrend(input: InsightInput, insights: Insight[]) {
  const { chartData } = input;
  if (chartData.length < 7) return;

  const mid = Math.floor(chartData.length / 2);
  const firstHalf = chartData.slice(0, mid);
  const secondHalf = chartData.slice(mid);

  const avgMargin = (
    data: Array<{ revenue: number; grossProfit: number }>,
  ) => {
    const totalRev = data.reduce((s, d) => s + d.revenue, 0);
    const totalProfit = data.reduce((s, d) => s + d.grossProfit, 0);
    return totalRev > 0 ? (totalProfit / totalRev) * 100 : 0;
  };

  const firstMargin = avgMargin(firstHalf);
  const secondMargin = avgMargin(secondHalf);
  const diff = secondMargin - firstMargin;

  if (Math.abs(diff) < 3) return;

  if (diff < 0) {
    insights.push({
      id: "margin-trend-down",
      type: "warning",
      title: "Margins are declining",
      description: `Average margin dropped from ${firstMargin.toFixed(1)}% to ${secondMargin.toFixed(1)}% over the selected period — a ${Math.abs(diff).toFixed(1)} point decline.`,
      priority: 2,
    });
  } else {
    insights.push({
      id: "margin-trend-up",
      type: "success",
      title: "Margins are improving",
      description: `Average margin improved from ${firstMargin.toFixed(1)}% to ${secondMargin.toFixed(1)}% over the selected period — up ${diff.toFixed(1)} points.`,
      priority: 7,
    });
  }
}

function profitConcentration(input: InsightInput, insights: Insight[]) {
  const { topProducts, metrics } = input;
  if (topProducts.length < 4 || metrics.grossProfit <= 0) return;

  const top3Profit = topProducts
    .slice(0, 3)
    .reduce((s, p) => s + p.grossProfit, 0);
  const concentrationPct = (top3Profit / metrics.grossProfit) * 100;

  if (concentrationPct > 60) {
    insights.push({
      id: "profit-concentration",
      type: "warning",
      title: "Profit is highly concentrated",
      description: `Your top 3 products generate ${concentrationPct.toFixed(0)}% of total profit. If any of them slows down, it could significantly impact your bottom line.`,
      priority: 3,
    });
  }
}

function highMarginLowVolume(input: InsightInput, insights: Insight[]) {
  const { topProducts } = input;
  if (topProducts.length < 4) return;

  const byMargin = [...topProducts].sort(
    (a, b) => b.marginPct - a.marginPct,
  );
  const highestMargin = byMargin[0];

  const byVolume = [...topProducts].sort(
    (a, b) => a.unitsSold - b.unitsSold,
  );
  const lowVolumeThreshold = Math.ceil(topProducts.length / 3);
  const lowVolumeSet = new Set(
    byVolume.slice(0, lowVolumeThreshold).map((p) => p.productId),
  );

  if (
    lowVolumeSet.has(highestMargin.productId) &&
    highestMargin.marginPct > 30
  ) {
    insights.push({
      id: "high-margin-low-volume",
      type: "opportunity",
      title: `Promote "${highestMargin.productTitle}"`,
      description: `This product has your highest margin (${highestMargin.marginPct.toFixed(1)}%) but is one of your lowest sellers (${highestMargin.unitsSold} units). Promoting it could boost overall profitability.`,
      priority: 4,
    });
  }
}

function discountEffectiveness(input: InsightInput, insights: Insight[]) {
  const { discountAnalysis } = input;
  if (!discountAnalysis || discountAnalysis.discountedOrderCount === 0) return;

  const marginDiff =
    discountAnalysis.discountedAvgMargin -
    discountAnalysis.nonDiscountedAvgMargin;
  const aovRatio =
    discountAnalysis.nonDiscountedAvgOrderValue > 0
      ? discountAnalysis.discountedAvgOrderValue /
        discountAnalysis.nonDiscountedAvgOrderValue
      : 1;

  if (marginDiff < -5 && aovRatio < 1.1) {
    insights.push({
      id: "discount-ineffective",
      type: "warning",
      title: "Discounts are cutting margins without increasing order size",
      description: `Discounted orders have ${Math.abs(marginDiff).toFixed(1)} points lower margins but similar average order values. Consider whether your discounts are driving incremental sales or just subsidizing purchases that would happen anyway.`,
      priority: 5,
    });
  } else if (marginDiff < -5 && aovRatio >= 1.2) {
    insights.push({
      id: "discount-tradeoff",
      type: "info",
      title: "Discounts trade margin for larger orders",
      description: `Discounted orders have ${Math.abs(marginDiff).toFixed(1)} points lower margins but ${((aovRatio - 1) * 100).toFixed(0)}% higher average order values — a reasonable tradeoff.`,
      priority: 7,
    });
  }
}

function worstDiscountCode(input: InsightInput, insights: Insight[]) {
  const { discountAnalysis } = input;
  if (!discountAnalysis || discountAnalysis.byCode.length === 0) return;

  const worst = discountAnalysis.byCode.find(
    (c) => c.avgMarginPct < 15 && c.orderCount >= 2,
  );
  if (worst) {
    insights.push({
      id: "worst-discount",
      type: "warning",
      title: `Discount "${worst.code}" is eroding profits`,
      description: `This code drives margins down to ${worst.avgMarginPct.toFixed(1)}% across ${worst.orderCount} orders. After payment fees, you may be losing money on these sales.`,
      priority: 5,
    });
  }
}

function weekendPattern(input: InsightInput, insights: Insight[]) {
  const { chartData } = input;
  if (chartData.length < 14) return;

  let weekdayRev = 0,
    weekdayProfit = 0,
    weekdayDays = 0;
  let weekendRev = 0,
    weekendProfit = 0,
    weekendDays = 0;

  for (const d of chartData) {
    const dayOfWeek = new Date(d.date + "T12:00:00").getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    if (isWeekend) {
      weekendRev += d.revenue;
      weekendProfit += d.grossProfit;
      weekendDays++;
    } else {
      weekdayRev += d.revenue;
      weekdayProfit += d.grossProfit;
      weekdayDays++;
    }
  }

  if (weekendDays < 2 || weekdayDays < 5) return;

  const weekdayMargin =
    weekdayRev > 0 ? (weekdayProfit / weekdayRev) * 100 : 0;
  const weekendMargin =
    weekendRev > 0 ? (weekendProfit / weekendRev) * 100 : 0;
  const diff = weekendMargin - weekdayMargin;

  if (Math.abs(diff) < 5) return;

  if (diff < 0) {
    insights.push({
      id: "weekend-lower",
      type: "info",
      title: "Weekend orders have lower margins",
      description: `Weekend margins average ${weekendMargin.toFixed(1)}% vs ${weekdayMargin.toFixed(1)}% on weekdays — a ${Math.abs(diff).toFixed(1)} point gap. Check if weekend promotions or product mix are driving this.`,
      priority: 7,
    });
  } else {
    insights.push({
      id: "weekend-higher",
      type: "info",
      title: "Weekend orders are more profitable",
      description: `Weekend margins average ${weekendMargin.toFixed(1)}% vs ${weekdayMargin.toFixed(1)}% on weekdays. Consider focusing ad spend on weekends.`,
      priority: 7,
    });
  }
}

function expenseImpact(input: InsightInput, insights: Insight[]) {
  const { metrics, expenseData } = input;
  if (!expenseData) return;

  const marginDrop = metrics.avgMarginPct - expenseData.adjustedMarginPct;
  if (marginDrop > 10) {
    insights.push({
      id: "expense-impact",
      type: "warning",
      title: "Overhead is significantly impacting margins",
      description: `Your ${metrics.avgMarginPct.toFixed(1)}% gross margin drops to ${expenseData.adjustedMarginPct.toFixed(1)}% after accounting for $${expenseData.totalMonthlyExpenses.toFixed(0)}/mo in overhead — a ${marginDrop.toFixed(1)} point reduction.`,
      priority: 6,
    });
  } else if (marginDrop > 5) {
    insights.push({
      id: "expense-impact",
      type: "info",
      title: "Overhead expenses reduce margins moderately",
      description: `Gross margin of ${metrics.avgMarginPct.toFixed(1)}% drops to ${expenseData.adjustedMarginPct.toFixed(1)}% after $${expenseData.totalMonthlyExpenses.toFixed(0)}/mo in overhead.`,
      priority: 8,
    });
  }
}
