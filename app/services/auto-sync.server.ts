import db from "../db.server";
import { syncAllProductCosts } from "./cost-sync.server";
import { syncHistoricalOrders } from "./order-sync.server";

// Runs the initial product + order sync the first time a shop opens the app.
//
// Before this existed, nothing synced on install: the merchant landed on an
// empty dashboard and had to find the Setup page and click two buttons. Every
// outside evaluator we have records for (2026-10-05) ended with zero synced
// rows, and the App Store listing promised "historical order sync on install"
// the whole time. This makes the promise true.
//
// The work runs in the background and the loader returns immediately, so a
// large catalog never blocks first paint. Railway runs one persistent replica,
// so a detached promise does complete; this would not be safe on a
// per-request serverless runtime.

// Enough history to populate every dashboard range, including Pro's 90d.
const INITIAL_DAYS_BACK = 90;

// A shop with genuinely zero products would otherwise re-trigger on every
// load. One attempt per window is plenty; Setup still offers a manual sync.
const RETRY_AFTER_MS = 15 * 60 * 1000;

type Attempt = { startedAt: number; done: boolean };

// In-memory is sufficient for a single replica. A restart simply allows one
// more attempt, and both syncs are idempotent (upsert / skipDuplicates).
const attempts = new Map<string, Attempt>();

export type InitialSyncState =
  /** Data exists — render the real dashboard. */
  | "ready"
  /** Initial sync is in flight — render a progress state and poll. */
  | "syncing"
  /** Sync ran and found no products — render an honest empty state. */
  | "empty";

export async function ensureInitialSync(
  admin: any,
  shop: string,
): Promise<InitialSyncState> {
  // Check in-flight first: products may finish before orders do, and we want
  // the progress state to hold until the whole sync completes.
  const attempt = attempts.get(shop);
  if (attempt && !attempt.done) return "syncing";

  const productCount = await db.productCost.count({ where: { shop } });
  if (productCount > 0) return "ready";

  if (attempt && Date.now() - attempt.startedAt < RETRY_AFTER_MS) {
    return "empty";
  }

  attempts.set(shop, { startedAt: Date.now(), done: false });
  void runInitialSync(admin, shop);
  return "syncing";
}

async function runInitialSync(admin: any, shop: string): Promise<void> {
  const started = Date.now();
  try {
    const products = await syncAllProductCosts(admin, shop);
    const orders = await syncHistoricalOrders(admin, shop, INITIAL_DAYS_BACK);
    console.log(
      `[auto-sync] ${shop}: ${products.totalVariants ?? "?"} variants, ` +
        `${orders.ordersProcessed} orders, ${orders.lineItemsCreated} line items ` +
        `in ${Date.now() - started}ms`,
    );
  } catch (err) {
    // Logged, never thrown: the loader has already returned. The merchant
    // sees the "empty" state and Setup still offers a manual retry.
    console.error(`[auto-sync] initial sync failed for ${shop}:`, err);
  } finally {
    const a = attempts.get(shop);
    if (a) a.done = true;
  }
}
