ALTER TABLE "Membership" ADD COLUMN "clientMutationId" TEXT;
ALTER TABLE "PaymentMovement" ADD COLUMN "clientMutationId" TEXT;

CREATE TABLE "SyncReceipt" (
  "id" TEXT NOT NULL,
  "gymId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "result" JSONB,
  "message" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SyncReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Membership_clientMutationId_key" ON "Membership"("clientMutationId");
CREATE UNIQUE INDEX "PaymentMovement_clientMutationId_key" ON "PaymentMovement"("clientMutationId");
CREATE INDEX "SyncReceipt_gymId_createdAt_idx" ON "SyncReceipt"("gymId", "createdAt");

ALTER TABLE "SyncReceipt" ADD CONSTRAINT "SyncReceipt_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SyncReceipt" ADD CONSTRAINT "SyncReceipt_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
