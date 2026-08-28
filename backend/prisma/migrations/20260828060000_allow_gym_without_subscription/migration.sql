ALTER TABLE "Gym"
ALTER COLUMN "subscriptionPlan" DROP NOT NULL,
ALTER COLUMN "subscriptionPlan" DROP DEFAULT,
ALTER COLUMN "subscriptionStartedAt" DROP NOT NULL,
ALTER COLUMN "subscriptionStartedAt" DROP DEFAULT,
ALTER COLUMN "subscriptionEndsAt" DROP NOT NULL,
ALTER COLUMN "subscriptionEndsAt" DROP DEFAULT;
