CREATE TYPE "SubscriptionRequestAction" AS ENUM ('ACTIVATE', 'RENEW', 'CHANGE');

ALTER TABLE "SubscriptionRequest"
ADD COLUMN "action" "SubscriptionRequestAction" NOT NULL DEFAULT 'ACTIVATE',
ADD COLUMN "fromPlan" "GymSubscriptionPlan",
ADD COLUMN "previousEndsAt" TIMESTAMP(3);

ALTER TABLE "Gym"
ADD COLUMN "scheduledSubscriptionPlan" "GymSubscriptionPlan",
ADD COLUMN "scheduledSubscriptionStartsAt" TIMESTAMP(3),
ADD COLUMN "scheduledSubscriptionEndsAt" TIMESTAMP(3);

UPDATE "SubscriptionRequest" AS request
SET
  "action" = CASE
    WHEN gym."subscriptionPlan" IS NULL THEN 'ACTIVATE'::"SubscriptionRequestAction"
    WHEN gym."subscriptionPlan" = request."plan" THEN 'RENEW'::"SubscriptionRequestAction"
    ELSE 'CHANGE'::"SubscriptionRequestAction"
  END,
  "fromPlan" = gym."subscriptionPlan",
  "previousEndsAt" = gym."subscriptionEndsAt"
FROM "Gym" AS gym
WHERE gym."id" = request."gymId";
