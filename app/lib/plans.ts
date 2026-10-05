/**
 * Free tier: the full profit picture, limited to a 30-day window.
 * Pro ($9.99/mo): longer ranges plus the features a merchant only wants
 * once the app is load-bearing.
 *
 * The primary gate is deliberately TIME, not features. A merchant has to
 * enter cost data before this app shows them anything, so the dashboard,
 * product margins, orders and P&L all stay free — gating the data-entry
 * step would kill the funnel at the moment the merchant is doing the work.
 *
 * Shared between server (billing mutations, loaders) and client (plan page).
 */

export const FREE_TIER = {
  /** Longest dashboard/P&L range available without Pro. */
  maxRangeDays: 30,
  allowDiscountAnalysis: false,
  allowExpenses: false,
  allowCsvImport: false,
  allowAiInsights: false,
};

/** Ranges the free plan may select. 90d is Pro. */
export const FREE_RANGES = ["7d", "30d"] as const;

export const PRO_PLAN = {
  name: "Profit Analytics Pro",
  price: 9.99,
  currencyCode: "USD",
  trialDays: 7,
};

/** Clamp a requested range to what the plan allows. */
export function allowedRange(range: string, isPaid: boolean): string {
  if (isPaid) return range;
  return (FREE_RANGES as readonly string[]).includes(range) ? range : "30d";
}
