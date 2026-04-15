import db from "../db.server";

export interface ExpenseSummary {
  totalMonthlyExpenses: number;
  adjustedProfit: number;
  adjustedMarginPct: number;
}

function normalizeToMonthly(amount: number, frequency: string): number {
  switch (frequency) {
    case "weekly":
      return amount * 4.33;
    case "yearly":
      return amount / 12;
    default:
      return amount;
  }
}

export async function getExpenseSummary(
  shop: string,
  grossProfit: number,
  totalRevenue: number,
  periodDays: number,
): Promise<ExpenseSummary | null> {
  const expenses = await db.expense.findMany({
    where: { shop, isActive: true },
  });

  if (expenses.length === 0) return null;

  let totalMonthlyExpenses = 0;
  for (const exp of expenses) {
    totalMonthlyExpenses += normalizeToMonthly(
      Number(exp.amount),
      exp.frequency,
    );
  }

  // Pro-rate to the selected period
  const periodExpenses = totalMonthlyExpenses * (periodDays / 30);
  const adjustedProfit = grossProfit - periodExpenses;
  const adjustedMarginPct =
    totalRevenue > 0 ? (adjustedProfit / totalRevenue) * 100 : 0;

  return {
    totalMonthlyExpenses,
    adjustedProfit,
    adjustedMarginPct,
  };
}

export async function getExpenses(shop: string) {
  return db.expense.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });
}

export async function createExpense(
  shop: string,
  data: {
    name: string;
    category: string;
    amount: number;
    frequency: string;
    allocationMethod: string;
  },
) {
  return db.expense.create({
    data: { shop, ...data },
  });
}

export async function deleteExpense(id: string, shop: string) {
  return db.expense.deleteMany({
    where: { id, shop },
  });
}
