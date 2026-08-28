ALTER TABLE "Membership"
ADD COLUMN "planName" TEXT,
ADD COLUMN "planPrice" DECIMAL(12,2),
ADD COLUMN "planDurationDays" INTEGER;

UPDATE "Membership" AS membership
SET
  "planName" = plan."name",
  "planPrice" = plan."price",
  "planDurationDays" = plan."durationDays"
FROM "Plan" AS plan
WHERE membership."planId" = plan."id";

ALTER TABLE "Membership"
ALTER COLUMN "planName" SET NOT NULL,
ALTER COLUMN "planPrice" SET NOT NULL,
ALTER COLUMN "planDurationDays" SET NOT NULL;
