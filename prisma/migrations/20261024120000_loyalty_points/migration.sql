-- Loyalty points: customer balance + carry-over, points used on orders, and the points ledger.
ALTER TABLE "customers" ADD COLUMN "points" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "customers" ADD COLUMN "pointsCarry" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "pointsUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "pointsAmount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "points_entries" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "paymentId" INTEGER,
    "orderId" INTEGER,
    "note" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "points_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "points_entries_customerId_createdAt_idx" ON "points_entries"("customerId", "createdAt");
CREATE INDEX "points_entries_paymentId_idx" ON "points_entries"("paymentId");
CREATE INDEX "points_entries_orderId_idx" ON "points_entries"("orderId");
ALTER TABLE "points_entries" ADD CONSTRAINT "points_entries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
