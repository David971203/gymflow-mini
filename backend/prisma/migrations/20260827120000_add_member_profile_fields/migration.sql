ALTER TABLE "Member"
ADD COLUMN "code" TEXT,
ADD COLUMN "age" INTEGER,
ADD COLUMN "sex" TEXT;

CREATE UNIQUE INDEX "Member_gymId_code_key" ON "Member"("gymId", "code");

ALTER TABLE "Member"
ADD CONSTRAINT "Member_age_check" CHECK ("age" IS NULL OR ("age" >= 1 AND "age" <= 120)),
ADD CONSTRAINT "Member_sex_check" CHECK ("sex" IS NULL OR "sex" IN ('MALE', 'FEMALE', 'OTHER'));
