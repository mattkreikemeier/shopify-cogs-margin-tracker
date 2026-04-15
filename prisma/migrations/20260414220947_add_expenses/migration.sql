-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "amount" DECIMAL(12,2) NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'monthly',
    "allocationMethod" TEXT NOT NULL DEFAULT 'proportional',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Expense_shop_idx" ON "Expense"("shop");

-- CreateIndex
CREATE INDEX "Expense_shop_isActive_idx" ON "Expense"("shop", "isActive");
