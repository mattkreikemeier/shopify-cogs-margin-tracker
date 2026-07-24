import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate, PLAN_NAME } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing } = await authenticate.admin(request);

  try {
    const { hasActivePayment } = await billing.check({ plans: [PLAN_NAME] });
    if (!hasActivePayment) {
      // isTest defaults to true in the library; production must create real charges.
      // BILLING_TEST=1 forces test charges in production, for verifying the
      // billing flow on a dev store without a payment method on file
      await billing.request({
        plan: PLAN_NAME,
        isTest:
          process.env.BILLING_TEST === "1" ||
          process.env.NODE_ENV !== "production",
      });
    }
  } catch (error) {
    // billing.request throws a Response redirect to Shopify's charge approval page
    // — rethrow those. Only swallow actual errors (e.g. dev store quirks).
    if (error instanceof Response) throw error;
    console.error("Billing error (non-fatal):", error);
  }

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Dashboard
        </Link>
        <Link to="/app/products">Products</Link>
        <Link to="/app/orders">Orders</Link>
        <Link to="/app/discounts">Discounts</Link>
        <Link to="/app/expenses">Expenses</Link>
        <Link to="/app/import">Import Costs</Link>
        <Link to="/app/setup">Setup</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
