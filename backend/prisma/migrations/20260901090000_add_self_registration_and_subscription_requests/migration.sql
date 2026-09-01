-- CreateEnum
CREATE TYPE "SubscriptionRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "phone" TEXT;

-- CreateTable
CREATE TABLE "SubscriptionRequest" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "plan" "GymSubscriptionPlan" NOT NULL,
    "status" "SubscriptionRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "SubscriptionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrialClaim" (
    "id" TEXT NOT NULL,
    "gymId" TEXT,
    "phone" TEXT NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrialClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionRequest_code_key" ON "SubscriptionRequest"("code");
CREATE INDEX "SubscriptionRequest_status_requestedAt_idx" ON "SubscriptionRequest"("status", "requestedAt");
CREATE INDEX "SubscriptionRequest_gymId_requestedAt_idx" ON "SubscriptionRequest"("gymId", "requestedAt");
CREATE UNIQUE INDEX "TrialClaim_gymId_key" ON "TrialClaim"("gymId");
CREATE UNIQUE INDEX "TrialClaim_phone_key" ON "TrialClaim"("phone");
CREATE UNIQUE INDEX "TrialClaim_deviceHash_key" ON "TrialClaim"("deviceHash");

ALTER TABLE "SubscriptionRequest" ADD CONSTRAINT "SubscriptionRequest_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrialClaim" ADD CONSTRAINT "TrialClaim_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE SET NULL ON UPDATE CASCADE;
