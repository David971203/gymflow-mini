CREATE TABLE "PlatformSubscription" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "plan" "GymSubscriptionPlan" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSubscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlatformSubscription_gymId_activatedAt_idx" ON "PlatformSubscription"("gymId", "activatedAt");
CREATE INDEX "PlatformSubscription_activatedAt_idx" ON "PlatformSubscription"("activatedAt");

ALTER TABLE "PlatformSubscription"
ADD CONSTRAINT "PlatformSubscription_gymId_fkey"
FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "PlatformSubscription" ("id", "gymId", "plan", "amount", "startedAt", "endsAt", "activatedAt")
SELECT
    CONCAT('initial-', "id"),
    "id",
    "subscriptionPlan",
    CASE
        WHEN "subscriptionPlan" = 'MONTHLY' THEN 5000
        WHEN "subscriptionPlan" = 'ANNUAL' THEN 50000
        ELSE 0
    END,
    "subscriptionStartedAt",
    "subscriptionEndsAt",
    "subscriptionStartedAt"
FROM "Gym";
