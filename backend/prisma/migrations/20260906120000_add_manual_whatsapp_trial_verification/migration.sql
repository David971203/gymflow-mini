ALTER TABLE "User" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);

ALTER TABLE "SubscriptionRequest"
ADD COLUMN "verificationPhone" TEXT,
ADD COLUMN "deviceHash" TEXT,
ADD COLUMN "ipHash" TEXT,
ADD COLUMN "resendCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastRequestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "SubscriptionRequest_verificationPhone_requestedAt_idx" ON "SubscriptionRequest"("verificationPhone", "requestedAt");
CREATE INDEX "SubscriptionRequest_deviceHash_requestedAt_idx" ON "SubscriptionRequest"("deviceHash", "requestedAt");
CREATE INDEX "SubscriptionRequest_ipHash_requestedAt_idx" ON "SubscriptionRequest"("ipHash", "requestedAt");
