-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "isCity" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ingest_configs" (
    "id" TEXT NOT NULL,
    "scraper" TEXT NOT NULL,
    "maxMonths" INTEGER NOT NULL DEFAULT 6,
    "maxPages" INTEGER NOT NULL DEFAULT 3,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingest_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ingest_configs_scraper_key" ON "ingest_configs"("scraper");
