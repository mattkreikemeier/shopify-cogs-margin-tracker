-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCost" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT NOT NULL DEFAULT '',
    "sku" TEXT NOT NULL DEFAULT '',
    "salePrice" DECIMAL(12,2) NOT NULL,
    "cost" DECIMAL(12,2),
    "marginPct" DECIMAL(5,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLineItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "lineItemId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT NOT NULL DEFAULT '',
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "unitCost" DECIMAL(12,2),
    "revenue" DECIMAL(12,2) NOT NULL,
    "grossProfit" DECIMAL(12,2),
    "marginPct" DECIMAL(5,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarginSnapshot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shop" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "totalRevenue" DECIMAL(14,2) NOT NULL,
    "totalCogs" DECIMAL(14,2) NOT NULL,
    "grossProfit" DECIMAL(14,2) NOT NULL,
    "avgMarginPct" DECIMAL(5,2) NOT NULL,
    "orderCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarginSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductCost_shop_idx" ON "ProductCost"("shop");

-- CreateIndex
CREATE INDEX "ProductCost_shop_marginPct_idx" ON "ProductCost"("shop", "marginPct");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCost_shop_variantId_key" ON "ProductCost"("shop", "variantId");

-- CreateIndex
CREATE INDEX "OrderLineItem_shop_idx" ON "OrderLineItem"("shop");

-- CreateIndex
CREATE INDEX "OrderLineItem_shop_orderDate_idx" ON "OrderLineItem"("shop", "orderDate");

-- CreateIndex
CREATE INDEX "OrderLineItem_shop_productId_idx" ON "OrderLineItem"("shop", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLineItem_shop_lineItemId_key" ON "OrderLineItem"("shop", "lineItemId");

-- CreateIndex
CREATE INDEX "MarginSnapshot_shop_idx" ON "MarginSnapshot"("shop");

-- CreateIndex
CREATE INDEX "MarginSnapshot_shop_snapshotDate_idx" ON "MarginSnapshot"("shop", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "MarginSnapshot_shop_snapshotDate_key" ON "MarginSnapshot"("shop", "snapshotDate");
