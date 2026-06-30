-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "shortName" TEXT;

-- CreateTable
CREATE TABLE "search_templates" (
    "id" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_sites" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_sites_pkey" PRIMARY KEY ("id")
);
