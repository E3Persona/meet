-- CreateTable
CREATE TABLE "source_site_configs" (
    "id" TEXT NOT NULL,
    "sourceSiteId" TEXT NOT NULL,
    "paginationType" TEXT,
    "paginationParam" TEXT,
    "paginationStart" INTEGER NOT NULL DEFAULT 1,
    "maxPages" INTEGER NOT NULL DEFAULT 5,
    "listingUrlTemplate" TEXT,
    "selectorEventContainer" TEXT,
    "selectorEventName" TEXT,
    "selectorEventDateStart" TEXT,
    "selectorEventDateEnd" TEXT,
    "selectorEventUrl" TEXT,
    "selectorVenue" TEXT,
    "selectorCity" TEXT,
    "followDetailPage" BOOLEAN NOT NULL DEFAULT false,
    "selectorDetailOrganizer" TEXT,
    "selectorDetailEmail" TEXT,
    "selectorDetailPhone" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestStatus" TEXT,
    "lastTestNotes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_site_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "source_site_configs_sourceSiteId_key" ON "source_site_configs"("sourceSiteId");

-- AddForeignKey
ALTER TABLE "source_site_configs" ADD CONSTRAINT "source_site_configs_sourceSiteId_fkey" FOREIGN KEY ("sourceSiteId") REFERENCES "source_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
