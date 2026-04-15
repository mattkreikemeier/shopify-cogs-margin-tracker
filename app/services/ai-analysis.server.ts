import Anthropic from "@anthropic-ai/sdk";
import db from "../db.server";
import {
  getDashboardMetrics,
  getTopProducts,
  getSnapshotData,
  getShopSettings,
} from "./margin-calculator.server";
import { getDiscountAnalysis } from "./discount-analytics.server";
import { getExpenseSummary } from "./expense-calculator.server";

const SYSTEM_PROMPT = `You are a profit margin analyst for a Shopify store. You analyze cost of goods sold (COGS), margins, discounts, and expenses data to provide actionable business recommendations.

Rules:
- ONLY reference numbers that appear in the data provided. Never invent or estimate figures.
- If the data is insufficient to draw a conclusion (e.g., fewer than 10 orders, less than 7 days of data), say so explicitly rather than guessing.
- Distinguish between correlation and causation. Say "this may suggest" or "consider investigating" rather than making definitive claims.
- Provide exactly 3-5 recommendations, ordered by potential impact.
- Each recommendation should have: a clear title in bold, the specific data that supports it, and a concrete action the merchant can take.
- Focus on profit improvement, not just revenue growth.
- Use plain language appropriate for a small business owner.
- Format each recommendation as a numbered paragraph. Start each with the number and a bold title using **double asterisks**, then the explanation on the same line.
- Do NOT use markdown headers (#, ##), horizontal rules (---), or bullet points. Just numbered paragraphs with bold titles.
- Do not repeat information already obvious from a dashboard (e.g., don't just restate the margin percentage).
- If cost data coverage is below 70%, start with a brief note about partial data, then proceed with recommendations.
- Never promise specific outcomes (e.g., "this will increase profit by 20%"). Instead frame as opportunities worth testing.
- Keep total response under 400 words.`;

interface ShopDataSummary {
  period: string;
  periodDays: number;
  totalRevenue: number;
  totalCogs: number;
  grossProfit: number;
  avgMarginPct: number;
  netProfit: number;
  netMarginPct: number;
  totalTransactionFees: number;
  orderCount: number;
  totalDiscounts: number;
  discountedOrderCount: number;
  costCoverage: { total: number; withCost: number; pct: number };
  topProducts: Array<{
    title: string;
    unitsSold: number;
    profit: number;
    marginPct: number;
  }>;
  marginTrend: { firstHalf: number; secondHalf: number; direction: string };
  discountedAvgMargin: number | null;
  nonDiscountedAvgMargin: number | null;
  discountedAvgOrderValue: number | null;
  nonDiscountedAvgOrderValue: number | null;
  monthlyOverhead: number | null;
  adjustedMarginPct: number | null;
}

function buildPrompt(summary: ShopDataSummary): string {
  let prompt = `Analyze this Shopify store's profitability data for the last ${summary.period}:

**Overall Metrics:**
- Revenue: $${summary.totalRevenue.toFixed(2)}
- COGS: $${summary.totalCogs.toFixed(2)}
- Gross Profit: $${summary.grossProfit.toFixed(2)} (${summary.avgMarginPct.toFixed(1)}% margin)
- Net Profit (after fees): $${summary.netProfit.toFixed(2)} (${summary.netMarginPct.toFixed(1)}% margin)
- Transaction Fees: $${summary.totalTransactionFees.toFixed(2)}
- Orders: ${summary.orderCount}
- Discounts Given: $${summary.totalDiscounts.toFixed(2)} (${summary.discountedOrderCount} discounted orders)

**Cost Data Coverage:** ${summary.costCoverage.withCost}/${summary.costCoverage.total} variants have costs (${summary.costCoverage.pct.toFixed(0)}%)

**Top Products by Profit:**
${summary.topProducts.map((p, i) => `${i + 1}. ${p.title}: ${p.unitsSold} units, $${p.profit.toFixed(2)} profit, ${p.marginPct.toFixed(1)}% margin`).join("\n")}

**Margin Trend:** ${summary.marginTrend.direction} (first half of period: ${summary.marginTrend.firstHalf.toFixed(1)}%, second half: ${summary.marginTrend.secondHalf.toFixed(1)}%)`;

  if (summary.discountedAvgMargin !== null) {
    prompt += `\n
**Discount Impact:**
- Discounted orders avg margin: ${summary.discountedAvgMargin.toFixed(1)}%
- Full-price orders avg margin: ${summary.nonDiscountedAvgMargin!.toFixed(1)}%
- Discounted avg order value: $${summary.discountedAvgOrderValue!.toFixed(2)}
- Full-price avg order value: $${summary.nonDiscountedAvgOrderValue!.toFixed(2)}`;
  }

  if (summary.monthlyOverhead !== null) {
    prompt += `\n
**Monthly Overhead:** $${summary.monthlyOverhead.toFixed(2)}/mo
- Adjusted margin after expenses: ${summary.adjustedMarginPct!.toFixed(1)}%`;
  }

  prompt +=
    "\n\nProvide 3-5 specific, actionable recommendations to improve this store's profitability.";

  return prompt;
}

async function aggregateShopData(
  shop: string,
  range: string,
): Promise<ShopDataSummary> {
  const endDate = new Date();
  const startDate = new Date();
  const periodDays = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  startDate.setDate(endDate.getDate() - periodDays);

  const settings = await getShopSettings(shop);
  const feeConfig = settings
    ? {
        rate: Number(settings.paymentFeeRate),
        flat: Number(settings.paymentFeeFlat),
      }
    : undefined;

  const [metrics, topProducts, chartData, discountAnalysis, totalVariants, variantsWithCost] =
    await Promise.all([
      getDashboardMetrics(shop, startDate, endDate, feeConfig),
      getTopProducts(shop, startDate, endDate, 10),
      getSnapshotData(shop, startDate, endDate),
      getDiscountAnalysis(shop, startDate, endDate),
      db.productCost.count({ where: { shop } }),
      db.productCost.count({ where: { shop, cost: { not: null } } }),
    ]);

  // Expense data
  const expenseData = await getExpenseSummary(
    shop,
    metrics.grossProfit,
    metrics.totalRevenue,
    periodDays,
  );

  // Margin trend
  const mid = Math.floor(chartData.length / 2);
  const firstHalf = chartData.slice(0, mid);
  const secondHalf = chartData.slice(mid);
  const calcMargin = (
    data: Array<{ revenue: number; grossProfit: number }>,
  ) => {
    const rev = data.reduce((s, d) => s + d.revenue, 0);
    const profit = data.reduce((s, d) => s + d.grossProfit, 0);
    return rev > 0 ? (profit / rev) * 100 : 0;
  };
  const firstMargin = calcMargin(firstHalf);
  const secondMargin = calcMargin(secondHalf);

  const period =
    range === "7d" ? "7 days" : range === "90d" ? "90 days" : "30 days";

  return {
    period,
    periodDays,
    totalRevenue: metrics.totalRevenue,
    totalCogs: metrics.totalCogs,
    grossProfit: metrics.grossProfit,
    avgMarginPct: metrics.avgMarginPct,
    netProfit: metrics.netProfit,
    netMarginPct: metrics.netMarginPct,
    totalTransactionFees: metrics.totalTransactionFees,
    orderCount: metrics.orderCount,
    totalDiscounts: metrics.totalDiscounts,
    discountedOrderCount: metrics.discountedOrderCount,
    costCoverage: {
      total: totalVariants,
      withCost: variantsWithCost,
      pct: totalVariants > 0 ? (variantsWithCost / totalVariants) * 100 : 0,
    },
    topProducts: topProducts.map((p) => ({
      title: p.productTitle,
      unitsSold: p.unitsSold,
      profit: p.grossProfit,
      marginPct: p.marginPct,
    })),
    marginTrend: {
      firstHalf: firstMargin,
      secondHalf: secondMargin,
      direction:
        secondMargin > firstMargin + 3
          ? "Improving"
          : secondMargin < firstMargin - 3
            ? "Declining"
            : "Stable",
    },
    discountedAvgMargin:
      discountAnalysis.discountedOrderCount > 0
        ? discountAnalysis.discountedAvgMargin
        : null,
    nonDiscountedAvgMargin:
      discountAnalysis.discountedOrderCount > 0
        ? discountAnalysis.nonDiscountedAvgMargin
        : null,
    discountedAvgOrderValue:
      discountAnalysis.discountedOrderCount > 0
        ? discountAnalysis.discountedAvgOrderValue
        : null,
    nonDiscountedAvgOrderValue:
      discountAnalysis.discountedOrderCount > 0
        ? discountAnalysis.nonDiscountedAvgOrderValue
        : null,
    monthlyOverhead: expenseData
      ? expenseData.totalMonthlyExpenses
      : null,
    adjustedMarginPct: expenseData
      ? expenseData.adjustedMarginPct
      : null,
  };
}

export async function getOrGenerateAiAnalysis(
  shop: string,
  range: string,
): Promise<{ analysis: string; cached: boolean; error?: string }> {
  // Check if API key is configured
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      analysis: "",
      cached: false,
      error: "AI analysis is not configured. Add ANTHROPIC_API_KEY to your environment variables.",
    };
  }

  // Check cache
  const cached = await db.aiAnalysisCache.findUnique({ where: { shop } });
  if (cached) {
    const ageMs = Date.now() - cached.updatedAt.getTime();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    if (ageMs < twentyFourHours) {
      return { analysis: cached.analysis, cached: true };
    }
  }

  // Aggregate data and call Claude
  try {
    const summary = await aggregateShopData(shop, range);
    const client = new Anthropic();
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildPrompt(summary),
        },
      ],
    });

    const textBlock = message.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    const analysis = textBlock?.text ?? "Unable to generate analysis.";

    // Cache result
    await db.aiAnalysisCache.upsert({
      where: { shop },
      create: { shop, analysis, period: range },
      update: { analysis, period: range },
    });

    return { analysis, cached: false };
  } catch (err) {
    console.error("AI analysis error:", err);
    return {
      analysis: "",
      cached: false,
      error: "Failed to generate AI analysis. Please try again later.",
    };
  }
}

export function isAiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
