-- Membership cancellation only affects access. Existing charges and collected
-- amounts remain financially valid and visible in Caja.
UPDATE "Payment"
SET
  "status" = CASE
    WHEN "paidAmount" >= "amount" THEN 'PAID'::"PaymentStatus"
    WHEN "paidAmount" > 0 THEN 'PARTIAL'::"PaymentStatus"
    ELSE 'PENDING'::"PaymentStatus"
  END,
  "paidAt" = CASE
    WHEN "paidAmount" >= "amount" THEN COALESCE("paidAt", "createdAt")
    ELSE NULL
  END
WHERE "status" = 'CANCELLED'::"PaymentStatus";

-- Older builds compared dueDate with the current instant, so a charge created
-- earlier today could already be marked overdue. Restore today's charges.
UPDATE "Payment"
SET "status" = CASE
  WHEN "paidAmount" > 0 THEN 'PARTIAL'::"PaymentStatus"
  ELSE 'PENDING'::"PaymentStatus"
END
WHERE "status" = 'OVERDUE'::"PaymentStatus"
  AND "dueDate" >= (
    date_trunc('day', NOW() AT TIME ZONE 'America/Havana')
    AT TIME ZONE 'America/Havana'
    AT TIME ZONE 'UTC'
  );
