-- AlterTable
ALTER TABLE "OrderLineItem" ADD COLUMN     "discountAmount" DECIMAL(12,2),
ADD COLUMN     "discountCodes" TEXT;

-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shop" TEXT NOT NULL,
    "paymentFeeRate" DECIMAL(5,3) NOT NULL DEFAULT 2.9,
    "paymentFeeFlat" DECIMAL(5,2) NOT NULL DEFAULT 0.30,
    "marginAlertThreshold" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shop_key" ON "ShopSettings"("shop");
