import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log("[Trigger Setup] Applying database trigger...")

  const sql = `
    -- First, drop the trigger and function if they already exist
    DROP TRIGGER IF EXISTS trg_clean_raw_venue ON events;
    DROP FUNCTION IF EXISTS clean_raw_venue_text();

    -- Create the trigger function
    CREATE OR REPLACE FUNCTION clean_raw_venue_text()
    RETURNS TRIGGER AS $$
    DECLARE
      matched_id VARCHAR;
    BEGIN
      -- If venueId is already set, clear rawVenueText
      IF NEW."venueId" IS NOT NULL THEN
        NEW."rawVenueText" := NULL;
      END IF;

      -- If venueId is null but rawVenueText is provided, try to match it against locations table
      IF NEW."venueId" IS NULL AND NEW."rawVenueText" IS NOT NULL AND NEW."rawVenueText" <> '' THEN
        SELECT id INTO matched_id FROM locations
        WHERE type = 'VENUE'
          AND active = true
          AND LOWER(TRIM(name)) = LOWER(TRIM(NEW."rawVenueText"))
        LIMIT 1;

        IF matched_id IS NOT NULL THEN
          NEW."venueId" := matched_id;
          NEW."matchType" := 'venue_matched';
          NEW."rawVenueText" := NULL;
        END IF;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    -- Create the trigger
    CREATE TRIGGER trg_clean_raw_venue
    BEFORE INSERT OR UPDATE ON events
    FOR EACH ROW
    EXECUTE FUNCTION clean_raw_venue_text();
  `

  await prisma.$executeRawUnsafe(sql)
  console.log("[Trigger Setup] Trigger applied successfully.")
}

main()
  .catch((e) => {
    console.error("[Trigger Setup] Error:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
