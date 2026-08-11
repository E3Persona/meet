-- Flexible manually-entered event details.
ALTER TABLE "events"
  ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "metadataUpdatedAt" TIMESTAMP(3);
