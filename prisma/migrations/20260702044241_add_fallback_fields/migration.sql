-- AlterTable
ALTER TABLE "source_site_configs" ADD COLUMN     "aiFallback" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "firecrawlFallback" BOOLEAN NOT NULL DEFAULT true;
