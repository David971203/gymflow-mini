-- CreateEnum
CREATE TYPE "AttendanceMethod" AS ENUM ('QR', 'MANUAL');

-- Add a stable, non-sequential QR token to every existing member.
ALTER TABLE "Member" ADD COLUMN "qrCode" TEXT;
UPDATE "Member"
SET "qrCode" = LOWER(
  SUBSTRING(MD5("id" || CLOCK_TIMESTAMP()::text || RANDOM()::text), 1, 8) || '-' ||
  SUBSTRING(MD5("id" || CLOCK_TIMESTAMP()::text || RANDOM()::text), 9, 4) || '-4' ||
  SUBSTRING(MD5("id" || CLOCK_TIMESTAMP()::text || RANDOM()::text), 14, 3) || '-a' ||
  SUBSTRING(MD5("id" || CLOCK_TIMESTAMP()::text || RANDOM()::text), 18, 3) || '-' ||
  SUBSTRING(MD5("id" || CLOCK_TIMESTAMP()::text || RANDOM()::text), 21, 12)
);
ALTER TABLE "Member" ALTER COLUMN "qrCode" SET NOT NULL;
CREATE UNIQUE INDEX "Member_qrCode_key" ON "Member"("qrCode");

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "checkInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkOutAt" TIMESTAMP(3),
    "method" "AttendanceMethod" NOT NULL DEFAULT 'MANUAL',
    "clientCheckInId" TEXT,
    "clientCheckOutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Attendance_clientCheckInId_key" ON "Attendance"("clientCheckInId");
CREATE UNIQUE INDEX "Attendance_clientCheckOutId_key" ON "Attendance"("clientCheckOutId");
CREATE UNIQUE INDEX "Attendance_memberId_open_key" ON "Attendance"("memberId") WHERE "checkOutAt" IS NULL;
CREATE INDEX "Attendance_gymId_checkInAt_idx" ON "Attendance"("gymId", "checkInAt");
CREATE INDEX "Attendance_memberId_checkInAt_idx" ON "Attendance"("memberId", "checkInAt");

ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
