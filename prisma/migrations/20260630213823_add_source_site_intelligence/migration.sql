-- CreateEnum
CREATE TYPE "ScrapeMode" AS ENUM ('auto', 'calendar', 'directory', 'search', 'skip');

-- CreateEnum
CREATE TYPE "ScrapeStatus" AS ENUM ('success', 'partial', 'failed', 'blocked');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "sourceSiteId" TEXT;

-- AlterTable
ALTER TABLE "source_sites" ADD COLUMN     "eventsFound" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastScrapeStatus" "ScrapeStatus",
ADD COLUMN     "lastScrapedAt" TIMESTAMP(3),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "scrapeMode" "ScrapeMode" NOT NULL DEFAULT 'auto',
ADD COLUMN     "urlPattern" TEXT;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_sourceSiteId_fkey" FOREIGN KEY ("sourceSiteId") REFERENCES "source_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
