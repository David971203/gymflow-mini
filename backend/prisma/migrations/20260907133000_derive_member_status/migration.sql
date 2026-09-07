-- A member without a current membership must start inactive.
ALTER TABLE "Member" ALTER COLUMN "status" SET DEFAULT 'INACTIVE';

-- Reconcile legacy membership rows using the same Cuban calendar-day boundary
-- used by the application. Prisma stores these instants as UTC timestamps.
WITH boundary AS (
  SELECT (((date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'America/Havana') + INTERVAL '1 day') AT TIME ZONE 'America/Havana') AT TIME ZONE 'UTC') AS next_day_start
)
UPDATE "Membership"
SET "status" = 'EXPIRED'
FROM boundary
WHERE "Membership"."status" IN ('ACTIVE', 'SCHEDULED')
  AND "Membership"."endDate" < boundary.next_day_start;

WITH boundary AS (
  SELECT (((date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'America/Havana') + INTERVAL '1 day') AT TIME ZONE 'America/Havana') AT TIME ZONE 'UTC') AS next_day_start
)
UPDATE "Membership"
SET "status" = 'ACTIVE'
FROM boundary
WHERE "Membership"."status" = 'SCHEDULED'
  AND "Membership"."startDate" < boundary.next_day_start
  AND "Membership"."endDate" >= boundary.next_day_start;

WITH boundary AS (
  SELECT (((date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'America/Havana') + INTERVAL '1 day') AT TIME ZONE 'America/Havana') AT TIME ZONE 'UTC') AS next_day_start
)
UPDATE "Membership"
SET "status" = 'SCHEDULED'
FROM boundary
WHERE "Membership"."status" = 'ACTIVE'
  AND "Membership"."startDate" >= boundary.next_day_start;

WITH boundary AS (
  SELECT (((date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'America/Havana') + INTERVAL '1 day') AT TIME ZONE 'America/Havana') AT TIME ZONE 'UTC') AS next_day_start
)
UPDATE "Member"
SET "status" = CASE WHEN EXISTS (
  SELECT 1
  FROM "Membership", boundary
  WHERE "Membership"."memberId" = "Member"."id"
    AND "Membership"."status" = 'ACTIVE'
    AND "Membership"."startDate" < boundary.next_day_start
    AND "Membership"."endDate" >= boundary.next_day_start
) THEN 'ACTIVE'::"MemberStatus" ELSE 'INACTIVE'::"MemberStatus" END;
