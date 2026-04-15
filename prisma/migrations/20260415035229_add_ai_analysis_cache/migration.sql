-- CreateTable
CREATE TABLE "AiAnalysisCache" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shop" TEXT NOT NULL,
    "analysis" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT '30d',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAnalysisCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiAnalysisCache_shop_key" ON "AiAnalysisCache"("shop");

-- CreateIndex
CREATE INDEX "AiAnalysisCache_shop_idx" ON "AiAnalysisCache"("shop");
