ALTER TABLE "Member" ADD COLUMN "photoUpdatedAt" TIMESTAMP(3);

CREATE TABLE "MemberPhoto" (
    "memberId" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MemberPhoto_pkey" PRIMARY KEY ("memberId")
);

CREATE INDEX "MemberPhoto_gymId_idx" ON "MemberPhoto"("gymId");
ALTER TABLE "MemberPhoto" ADD CONSTRAINT "MemberPhoto_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
