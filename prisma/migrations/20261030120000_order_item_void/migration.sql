-- An order item voided together with its payment: off the bill, kept for history.
ALTER TABLE "order_items" ADD COLUMN "voidedAt" TIMESTAMP(3);
ALTER TABLE "order_items" ADD COLUMN "voidReason" TEXT;
