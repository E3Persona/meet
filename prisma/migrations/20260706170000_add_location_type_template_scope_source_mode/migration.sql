-- Create enum types
CREATE TYPE "LocationType" AS ENUM ('CITY', 'VENUE');
CREATE TYPE "TemplateScope" AS ENUM ('CITY', 'VENUE', 'GLOBAL');
CREATE TYPE "SourceMode" AS ENUM ('automated', 'manual');

-- Location: add type, parentId; migrate isCity data; drop isCity
ALTER TABLE "locations" ADD COLUMN "type" "LocationType" NOT NULL DEFAULT 'VENUE';
ALTER TABLE "locations" ADD COLUMN "parentId" TEXT;
-- Most existing locations are venues; update any that had isCity=true
UPDATE "locations" SET "type" = 'CITY' WHERE "isCity" = true;
ALTER TABLE "locations" DROP COLUMN "isCity";

-- Add self-referencing FK for parentId
ALTER TABLE "locations" ADD CONSTRAINT "locations_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "locations"("id") ON DELETE CASCADE;
CREATE INDEX "locations_type_parentId_idx" ON "locations"("type", "parentId");

-- SearchTerm: make locationId nullable
ALTER TABLE "search_terms" ALTER COLUMN "locationId" DROP NOT NULL;

-- SearchTemplate: add scope with sensible defaults
ALTER TABLE "search_templates" ADD COLUMN "scope" "TemplateScope" NOT NULL DEFAULT 'CITY';
-- Templates with {VENUE} → VENUE scope
UPDATE "search_templates" SET "scope" = 'VENUE' WHERE "template" LIKE '%{VENUE}%';
-- Templates with no {CITY} or {VENUE} or {MONTH}/{YEAR} → GLOBAL (literal phrases)
UPDATE "search_templates" SET "scope" = 'GLOBAL' WHERE
  "template" NOT LIKE '%{CITY}%' AND
  "template" NOT LIKE '%{VENUE}%' AND
  "template" NOT LIKE '%{MONTH}%' AND
  "template" NOT LIKE '%{YEAR}%';

-- Event: add expectedAttendees
ALTER TABLE "events" ADD COLUMN "expectedAttendees" INTEGER;

-- SourceSite: add sourceMode, manualCheckFrequencyDays, lastManualCheckAt
ALTER TABLE "source_sites" ADD COLUMN "sourceMode" "SourceMode" NOT NULL DEFAULT 'automated';
ALTER TABLE "source_sites" ADD COLUMN "manualCheckFrequencyDays" INTEGER;
ALTER TABLE "source_sites" ADD COLUMN "lastManualCheckAt" TIMESTAMP(3);
