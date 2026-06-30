-- AlterTable
ALTER TABLE "ingestion_runs" ADD COLUMN     "providersUsed" JSONB;

-- CreateTable
CREATE TABLE "ingestion_schedules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cronExpr" TEXT NOT NULL,
    "locationIds" TEXT[],
    "templateIds" TEXT[],
    "sourceSiteIds" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingestion_schedules_pkey" PRIMARY KEY ("id")
);
