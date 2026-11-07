-- Cancelled (voided) receipts: when the owner marked them as seen on the dashboard, and who.
ALTER TABLE "payments" ADD COLUMN "voidSeenAt" TIMESTAMP(3);
ALTER TABLE "payments" ADD COLUMN "voidSeenById" INTEGER;
ALTER TABLE "payments" ADD CONSTRAINT "payments_voidSeenById_fkey" FOREIGN KEY ("voidSeenById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_deposits" ADD COLUMN "voidSeenAt" TIMESTAMP(3);
ALTER TABLE "customer_deposits" ADD COLUMN "voidSeenById" INTEGER;
ALTER TABLE "customer_deposits" ADD CONSTRAINT "customer_deposits_voidSeenById_fkey" FOREIGN KEY ("voidSeenById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
